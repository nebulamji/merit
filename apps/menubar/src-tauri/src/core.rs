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

/// Size in bytes of a file inside Merit's home (so the dashboard can tell an empty session without reading it).
#[tauri::command]
pub fn file_size(name: String) -> Result<u64, String> {
    fs::metadata(inside(&name)?).map(|m| m.len()).map_err(|e| e.to_string())
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

// ---- native Merkle commitment over a session's key events (the same bytes the TypeScript produces; held to shared vectors)
use sha2::{Digest, Sha256};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KeyIn { seq: u64, t: u64, k: String, n: Option<u64> }

/// Canonical JSON for an event: keys sorted, no spaces, exactly as the TypeScript canonicalJSON writes it. Anything unusual is refused
/// (the caller then falls back to the TypeScript path), so this can never silently disagree.
fn canon_event(e: &KeyIn) -> Result<String, String> {
    if e.k.is_empty() || !e.k.bytes().all(|c| c.is_ascii_lowercase() || c == b'_') { return Err("unsupported event".into()); }
    Ok(match e.n {
        Some(n) => format!("{{\"k\":\"{}\",\"n\":{},\"seq\":{},\"t\":{}}}", e.k, n, e.seq, e.t),
        None => format!("{{\"k\":\"{}\",\"seq\":{},\"t\":{}}}", e.k, e.seq, e.t),
    })
}

pub fn merkle_root(keys: &[KeyIn], secret: &[u8]) -> Result<[u8; 32], String> {
    let mut level: Vec<[u8; 32]> = Vec::with_capacity(keys.len());
    for e in keys {
        let mut h = Sha256::new(); h.update(secret); h.update(b":"); h.update(e.seq.to_string().as_bytes());
        let salt = h.finalize();
        let mut l = Sha256::new(); l.update([0u8]); l.update(salt); l.update(canon_event(e)?.as_bytes());
        level.push(l.finalize().into());
    }
    if level.is_empty() { return Ok(Sha256::digest([]).into()); }
    while level.len() > 1 {
        let mut next = Vec::with_capacity(level.len() / 2 + 1);
        for pair in level.chunks(2) {
            if pair.len() == 2 { let mut h = Sha256::new(); h.update([1u8]); h.update(pair[0]); h.update(pair[1]); next.push(h.finalize().into()); } else { next.push(pair[0]); }
        }
        level = next;
    }
    Ok(level[0])
}

/// The commitment root for a session's events, computed natively: a long session signs in a fraction of a second instead of freezing the window.
#[tauri::command]
pub async fn events_root(keys: Vec<KeyIn>, secret_hex: String) -> Result<String, String> {
    let secret = hex::decode(&secret_hex).map_err(|_| "bad secret".to_string())?;
    tauri::async_runtime::spawn_blocking(move || merkle_root(&keys, &secret).map(hex::encode)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod root_tests {
    use super::*;
    #[derive(serde::Deserialize)]
    struct V { secret: String, keys: Vec<KeyIn>, root: String }

    #[test]
    fn matches_every_typescript_vector_byte_for_byte() {
        let v: Vec<V> = serde_json::from_str(include_str!("../../test/vectors/events-root.json")).unwrap();
        assert!(v.len() >= 15);
        for (i, x) in v.iter().enumerate() {
            let got = hex::encode(merkle_root(&x.keys, &hex::decode(&x.secret).unwrap()).unwrap());
            assert_eq!(got, x.root, "vector {i} ({} events)", x.keys.len());
        }
    }

    #[test]
    fn refuses_anything_unusual_instead_of_guessing() {
        for k in ["", "Char", "ch ar", "char\"", "ch\\ar", "ünï"] {
            let e = KeyIn { seq: 0, t: 0, k: k.to_string(), n: None };
            assert!(merkle_root(&[e], b"s").is_err(), "{k:?}");
        }
        assert!(serde_json::from_str::<KeyIn>(r#"{"seq":0,"t":1,"k":"char","text":"a"}"#).is_err(), "unknown fields are refused");
        assert!(serde_json::from_str::<KeyIn>(r#"{"seq":0,"t":1.5,"k":"char"}"#).is_err(), "fractional time is refused");
    }

    #[test]
    fn a_very_long_session_is_fast() {
        let keys: Vec<KeyIn> = (0..100_000u64).map(|i| KeyIn { seq: i, t: i * 90, k: "char".into(), n: None }).collect();
        let t0 = std::time::Instant::now();
        let r = merkle_root(&keys, &[7u8; 32]).unwrap();
        let ms = t0.elapsed().as_millis();
        println!("NATIVE COMMIT: 100,000 events in {ms} ms (root {})", &hex::encode(r)[..12]);
        // The speed bound only means something in an optimized build; debug builds (what the tests normally run) are far slower.
        if !cfg!(debug_assertions) { assert!(ms < 3000, "took {ms} ms"); }
    }
}
