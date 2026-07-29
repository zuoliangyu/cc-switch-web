//! 项目 Profile 数据访问对象。

use crate::database::{lock_conn, Database};
use crate::error::AppError;
use rusqlite::params;

const CURRENT_PROFILE_ID_KEY_PREFIX: &str = "current_profile_id_";

fn current_profile_key(scope: &str) -> String {
    format!("{CURRENT_PROFILE_ID_KEY_PREFIX}{scope}")
}

#[derive(Debug, Clone)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub payload: String,
    pub sort_order: Option<i64>,
    pub created_at: Option<i64>,
    pub updated_at: Option<i64>,
}

impl Database {
    pub fn get_all_profiles(&self) -> Result<Vec<Profile>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare(
                "SELECT id, name, payload, sort_order, created_at, updated_at
                 FROM profiles
                 ORDER BY sort_order IS NULL, sort_order, created_at, id",
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(Profile {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    payload: row.get(2)?,
                    sort_order: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            })
            .map_err(|e| AppError::Database(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| AppError::Database(e.to_string()))
    }

    pub fn get_profile(&self, id: &str) -> Result<Option<Profile>, AppError> {
        let conn = lock_conn!(self.conn);
        let result = conn.query_row(
            "SELECT id, name, payload, sort_order, created_at, updated_at
             FROM profiles WHERE id = ?1",
            params![id],
            |row| {
                Ok(Profile {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    payload: row.get(2)?,
                    sort_order: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            },
        );
        match result {
            Ok(profile) => Ok(Some(profile)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }

    pub fn save_profile(&self, profile: &Profile) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "INSERT OR REPLACE INTO profiles
             (id, name, payload, sort_order, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                profile.id,
                profile.name,
                profile.payload,
                profile.sort_order,
                profile.created_at,
                profile.updated_at,
            ],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn delete_profile(&self, id: &str) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute("DELETE FROM profiles WHERE id = ?1", params![id])
            .map(|affected| affected > 0)
            .map_err(|e| AppError::Database(e.to_string()))
    }

    pub fn get_current_profile_id(&self, scope: &str) -> Result<Option<String>, AppError> {
        self.get_setting(&current_profile_key(scope))
    }

    pub fn set_current_profile_id(&self, scope: &str, id: Option<&str>) -> Result<(), AppError> {
        let key = current_profile_key(scope);
        match id {
            Some(id) => self.set_setting(&key, id),
            None => {
                let conn = lock_conn!(self.conn);
                conn.execute("DELETE FROM settings WHERE key = ?1", params![key])
                    .map_err(|e| AppError::Database(e.to_string()))?;
                Ok(())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(id: &str, name: &str, sort_order: Option<i64>) -> Profile {
        Profile {
            id: id.to_string(),
            name: name.to_string(),
            payload: r#"{"providers":{"claude":null,"codex":null}}"#.to_string(),
            sort_order,
            created_at: Some(1_000),
            updated_at: Some(1_000),
        }
    }

    #[test]
    fn profile_crud_roundtrip_and_sorting() -> Result<(), AppError> {
        let db = Database::memory()?;
        db.save_profile(&sample("a", "Dev", Some(2)))?;
        db.save_profile(&sample("b", "Draw", Some(1)))?;
        db.save_profile(&sample("c", "Misc", None))?;

        assert_eq!(
            db.get_all_profiles()?
                .iter()
                .map(|profile| profile.id.as_str())
                .collect::<Vec<_>>(),
            vec!["b", "a", "c"]
        );
        let mut updated = sample("a", "Dev Renamed", Some(2));
        updated.updated_at = Some(2_000);
        db.save_profile(&updated)?;
        let got = db.get_profile("a")?.expect("profile exists");
        assert_eq!(got.name, "Dev Renamed");
        assert_eq!(got.updated_at, Some(2_000));
        assert!(got.payload.contains("providers"));
        assert!(db.delete_profile("a")?);
        assert!(!db.delete_profile("a")?);
        Ok(())
    }

    #[test]
    fn current_profile_id_is_scoped() -> Result<(), AppError> {
        let db = Database::memory()?;
        db.set_current_profile_id("claude", Some("a"))?;
        db.set_current_profile_id("codex", Some("b"))?;
        assert_eq!(db.get_current_profile_id("claude")?.as_deref(), Some("a"));
        assert_eq!(db.get_current_profile_id("codex")?.as_deref(), Some("b"));

        db.set_current_profile_id("claude", None)?;
        assert_eq!(db.get_current_profile_id("claude")?, None);
        assert_eq!(db.get_current_profile_id("codex")?.as_deref(), Some("b"));
        db.set_current_profile_id("claude", None)?;
        Ok(())
    }
}
