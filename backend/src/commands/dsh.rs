//! The DeepSeek account login shared by DSH Web and Desktop.

/// The DeepSeek account (OAuth) login shared by DSH Web and Desktop, with profile and balance.
pub(crate) async fn dsh_account_status_internal(
) -> Result<crate::services::dsh_account::DshAccountStatus, String> {
    crate::services::dsh_account::status().await
}

/// Sign out of the DeepSeek account for both DSH Web and Desktop.
pub(crate) async fn dsh_account_sign_out_internal() -> Result<(), String> {
    crate::services::dsh_account::sign_out().await
}

/// Start a DeepSeek account browser sign-in; the UI opens `authUrl` and polls.
///
/// The OAuth callback listens on the CC Switch server's own loopback address, so the
/// sign-in only completes when the browser runs on the same machine as the server.
pub(crate) async fn dsh_account_login_start_internal(
) -> Result<crate::services::dsh_account::DshLoginStart, String> {
    crate::services::dsh_account::start_login().await
}

/// `false` while waiting for the browser, `true` once the shared login is stored.
pub(crate) fn dsh_account_login_poll_internal(flow_id: &str) -> Result<bool, String> {
    crate::services::dsh_account::poll_login(flow_id)
}

pub(crate) fn dsh_account_login_cancel_internal(flow_id: &str) {
    crate::services::dsh_account::cancel_login(flow_id)
}
