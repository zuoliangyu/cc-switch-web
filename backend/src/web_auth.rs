use sha2::{Digest, Sha256};

const MIN_ACCESS_KEY_LENGTH: usize = 16;

#[derive(Clone)]
pub(crate) struct WebAccessKey {
    expected_hash: Option<[u8; 32]>,
}

impl WebAccessKey {
    pub(crate) fn new(value: Option<&str>) -> Result<Self, String> {
        let value = value.map(str::trim).filter(|value| !value.is_empty());
        if let Some(value) = value {
            if value.chars().count() < MIN_ACCESS_KEY_LENGTH {
                return Err(format!(
                    "CC_SWITCH_WEB_ACCESS_KEY must be at least {MIN_ACCESS_KEY_LENGTH} characters"
                ));
            }
            return Ok(Self {
                expected_hash: Some(hash_key(value)),
            });
        }

        Ok(Self {
            expected_hash: None,
        })
    }

    pub(crate) fn from_env() -> Result<Self, String> {
        Self::new(std::env::var("CC_SWITCH_WEB_ACCESS_KEY").ok().as_deref())
    }

    pub(crate) fn is_required(&self) -> bool {
        self.expected_hash.is_some()
    }

    pub(crate) fn verify(&self, candidate: Option<&str>) -> bool {
        let Some(expected) = self.expected_hash else {
            return true;
        };
        let Some(candidate) = candidate.map(str::trim).filter(|value| !value.is_empty()) else {
            return false;
        };
        let actual = hash_key(candidate);
        expected
            .iter()
            .zip(actual.iter())
            .fold(0_u8, |diff, (left, right)| diff | (left ^ right))
            == 0
    }
}

fn hash_key(value: &str) -> [u8; 32] {
    Sha256::digest(value.as_bytes()).into()
}

#[cfg(test)]
mod tests {
    use super::WebAccessKey;

    #[test]
    fn access_key_is_optional_but_enforced_when_configured() {
        let disabled = WebAccessKey::new(None).unwrap();
        assert!(!disabled.is_required());
        assert!(disabled.verify(None));

        let enabled = WebAccessKey::new(Some("correct-access-key")).unwrap();
        assert!(enabled.is_required());
        assert!(!enabled.verify(None));
        assert!(!enabled.verify(Some("wrong-access-key")));
        assert!(enabled.verify(Some("correct-access-key")));
    }

    #[test]
    fn access_key_rejects_weak_configuration() {
        let error = WebAccessKey::new(Some("too-short")).err().unwrap();
        assert!(error.contains("at least 16"));
    }
}
