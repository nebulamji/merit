// Native side of the dashboard: the signing key, signatures, files under ~/.merit, and network calls
// to an allowlist of hosts. The private key never crosses into the webview; the webview builds the
// certificate with the same TypeScript the CLI and the website use, and asks this side to sign it.
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use ed25519_dalek::{Signer, SigningKey};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const KC_SERVICE: &str = "merit-signing-key";
const KC_ACCOUNT: &str = "default";

/// MERIT_HOME selects an isolated data folder (tests, portable use). In that mode the system keychain
/// is never touched, so a test can never create or replace the real identity.
pub fn merit_home() -> PathBuf {
    std::env::var_os("MERIT_HOME").map(PathBuf::from).unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join(".merit"))
}
fn isolated() -> bool { std::env::var_os("MERIT_HOME").is_some() }

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KeyFile { private_key: String, public_key: String }

fn keychain_read() -> Option<String> {
    if isolated() { return None; }
    keyring::Entry::new(KC_SERVICE, KC_ACCOUNT).ok()?.get_password().ok()
}
fn keychain_write(sk: &str) -> bool {
    if isolated() { return false; }
    keyring::Entry::new(KC_SERVICE, KC_ACCOUNT).and_then(|e| e.set_password(sk)).is_ok()
}

/// Same rules as the CLI: Keychain first, ~/.merit/key.json as fallback, create in the Keychain if neither exists.
fn signing_key() -> Result<SigningKey, String> {
    let hex_sk = if let Some(k) = keychain_read() {
        k
    } else if let Ok(s) = fs::read_to_string(merit_home().join("key.json")) {
        serde_json::from_str::<KeyFile>(&s).map_err(|e| e.to_string())?.private_key
    } else {
        let mut seed = [0u8; 32];
        rand_core::RngCore::fill_bytes(&mut rand_core::OsRng, &mut seed);
        let sk = SigningKey::from_bytes(&seed);
        let h = hex::encode(sk.to_bytes());
        if !keychain_write(&h) {
            let _ = fs::create_dir_all(merit_home());
            let kf = KeyFile { private_key: h.clone(), public_key: hex::encode(sk.verifying_key().to_bytes()) };
            let p = merit_home().join("key.json");
            fs::write(&p, serde_json::to_string_pretty(&kf).unwrap()).map_err(|e| e.to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(&p, fs::Permissions::from_mode(0o600));
            }
        }
        h
    };
    let bytes: [u8; 32] = hex::decode(hex_sk.trim()).map_err(|e| e.to_string())?.try_into().map_err(|_| "bad key length".to_string())?;
    Ok(SigningKey::from_bytes(&bytes))
}

#[tauri::command]
pub fn public_key() -> Result<String, String> {
    Ok(hex::encode(signing_key()?.verifying_key().to_bytes()))
}

/// Sign bytes the webview prepared (a certificate's signing payload, or a recognition).
#[tauri::command]
pub fn sign(payload_b64: String) -> Result<String, String> {
    let msg = B64.decode(payload_b64).map_err(|e| e.to_string())?;
    Ok(hex::encode(signing_key()?.sign(&msg).to_bytes()))
}

/// Only files directly under ~/.merit/{sessions,recognitions} may be touched from the webview.
fn inside(name: &str) -> Result<PathBuf, String> {
    let p = Path::new(name);
    let ok = p.components().count() == 2
        && matches!(p.components().next().and_then(|c| c.as_os_str().to_str()), Some("sessions") | Some("recognitions"))
        && !name.contains("..");
    if !ok { return Err(format!("refused path {name}")); }
    Ok(merit_home().join(p))
}

#[tauri::command]
pub fn read_file(name: String) -> Result<String, String> {
    fs::read(inside(&name)?).map(|b| B64.encode(b)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_file(name: String, data_b64: String, private: bool) -> Result<(), String> {
    let p = inside(&name)?;
    if let Some(d) = p.parent() { let _ = fs::create_dir_all(d); }
    fs::write(&p, B64.decode(data_b64).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    if private {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&p, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

#[tauri::command]
pub fn list_files(dir: String) -> Result<Vec<String>, String> {
    if dir != "sessions" && dir != "recognitions" { return Err("refused".into()); }
    let mut v: Vec<String> = fs::read_dir(merit_home().join(&dir)).map(|rd| rd.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect()).unwrap_or_default();
    v.sort();
    Ok(v)
}

const HOSTS: &[&str] = &[
    "a.pool.opentimestamps.org", "b.pool.opentimestamps.org", "a.pool.eternitywall.com", "ots.btc.catallaxy.com",
    "alice.btc.calendar.opentimestamps.org", "bob.btc.calendar.opentimestamps.org", "finney.calendar.eternitywall.com", "btc.calendar.catallaxy.com",
    "mempool.space", "blockstream.info", "merit.artofficial.computer",
];

#[derive(Serialize)]
pub struct HttpOut { status: u16, body_b64: String }

#[tauri::command]
pub async fn http(method: String, url: String, body_b64: Option<String>, content_type: Option<String>) -> Result<HttpOut, String> {
    let host = url.strip_prefix("https://").and_then(|r| r.split(['/', ':']).next()).unwrap_or("");
    if !HOSTS.contains(&host) { return Err(format!("host not allowed: {host}")); }
    tauri::async_runtime::spawn_blocking(move || {
        let c = reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(30)).user_agent("merit-desktop/0.1").build().map_err(|e| e.to_string())?;
        let mut req = if method == "POST" { c.post(&url) } else { c.get(&url) };
        req = req.header("Accept", "application/vnd.opentimestamps.v1, application/json");
        if let Some(ct) = content_type { req = req.header("Content-Type", ct); }
        if let Some(b) = body_b64 { req = req.body(B64.decode(b).map_err(|e| e.to_string())?); }
        let r = req.send().map_err(|e| e.to_string())?;
        let status = r.status().as_u16();
        let body = r.bytes().map_err(|e| e.to_string())?;
        Ok(HttpOut { status, body_b64: B64.encode(body) })
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    // RFC 8032 §7.1 TEST 1: the native signer must match the standard (and therefore the TypeScript verifier).
    #[test]
    fn rfc8032_test1() {
        let sk: [u8; 32] = hex::decode("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60").unwrap().try_into().unwrap();
        let k = SigningKey::from_bytes(&sk);
        assert_eq!(hex::encode(k.verifying_key().to_bytes()), "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
        assert_eq!(hex::encode(k.sign(b"").to_bytes()), "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b");
    }
    #[test]
    fn paths_are_confined() {
        assert!(inside("sessions/a.jsonl").is_ok());
        assert!(inside("recognitions/x.json").is_ok());
        assert!(inside("../key.json").is_err());
        assert!(inside("sessions/../../x").is_err());
        assert!(inside("key.json").is_err());
        assert!(inside("/etc/passwd").is_err());
    }
}
