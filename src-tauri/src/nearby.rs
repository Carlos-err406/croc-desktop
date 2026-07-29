//! Nearby-peers discovery (SPIKE — discovery layer only).
//!
//! croc pairs by **code**; it has no notion of browsing for peers (its own
//! `peerdiscovery` use is internal to a single transfer). So "codeless LAN send"
//! needs a discovery layer *on top of* croc:
//!
//!   1. each app advertises `_croc._tcp.local.` with a friendly name + a "pair port"
//!   2. apps browse the same service type to list who's around  ← this module
//!   3. pairing carries NO custom protocol and NO listener: a receiver in
//!      "discoverable" mode advertises a **one-time code** in its TXT record and
//!      waits on `croc receive --local`. A sender reads that code straight off mDNS
//!      and sends. The consent gate is the receiver choosing to be discoverable.
//!
//! Same network constraint as local-only mode: needs multicast, so it won't work
//! across most phone hotspots.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

pub const SERVICE_TYPE: &str = "_croc._tcp.local.";

/// mDNS requires a port in the SRV record, but this model has no listener — pairing
/// happens entirely through the advertised code + croc itself. Published as 0 to make
/// "nothing is listening here" explicit.
pub const NO_LISTENER_PORT: u16 = 0;

/// A peer we've seen advertising on the LAN.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Peer {
    /// Stable-ish id (the mDNS fullname).
    pub id: String,
    /// Friendly device name from the TXT record (falls back to the instance name).
    pub name: String,
    /// First usable address we resolved.
    pub address: String,
    /// The peer's pair port — where a send request would be POSTed (step 3).
    pub port: u16,
    /// The croc version the peer bundles, so the UI can warn *before* pairing.
    pub croc_version: Option<String>,
    /// The one-time code this peer is waiting on, when it's discoverable. `None`
    /// means it's visible but not currently accepting — nothing to send to.
    pub code: Option<String>,
    /// True when this is our own advertisement (mDNS sees itself; hide in the UI).
    pub is_self: bool,
}

#[derive(Default)]
pub struct NearbyState {
    inner: Arc<Mutex<Inner>>,
}

#[derive(Default)]
struct Inner {
    /// Kept so we can register/unregister our advertisement on demand. Dropping it
    /// would also stop the browse loop.
    daemon: Option<mdns_sd::ServiceDaemon>,
    browsing: bool,
    /// Keyed by mDNS fullname so re-resolves update rather than duplicate.
    peers: HashMap<String, Peer>,
    /// Our advertised fullname while discoverable (None = not advertising).
    own_fullname: Option<String>,
}

impl NearbyState {
    /// Peers currently seen. Excludes our own advertisement — a sender never wants to
    /// pick themselves, and we already know our own code.
    pub fn peers(&self) -> Vec<Peer> {
        let inner = self.inner.lock().unwrap();
        let mut v: Vec<Peer> = inner
            .peers
            .values()
            .filter(|p| !p.is_self)
            .cloned()
            .collect();
        v.sort_by_key(|p| p.name.to_lowercase());
        v
    }

    /// Start *browsing* only. Deliberately does not advertise: we don't broadcast this
    /// device's name on every network the user joins — that only happens when they
    /// explicitly become discoverable. Idempotent.
    pub fn start_browsing(&self) -> Result<(), String> {
        let mut inner = self.inner.lock().unwrap();
        if inner.browsing {
            return Ok(());
        }
        let daemon = match inner.daemon.as_ref() {
            Some(d) => d.clone(),
            None => {
                let d = mdns_sd::ServiceDaemon::new().map_err(|e| e.to_string())?;
                inner.daemon = Some(d.clone());
                d
            }
        };
        let rx = daemon.browse(SERVICE_TYPE).map_err(|e| e.to_string())?;
        inner.browsing = true;
        drop(inner);

        let inner = Arc::clone(&self.inner);
        std::thread::spawn(move || {
            while let Ok(event) = rx.recv() {
                match event {
                    mdns_sd::ServiceEvent::ServiceResolved(svc) => {
                        // `addresses` is an unordered set and (verified via a spike)
                        // includes loopback + link-local alongside the routable LAN
                        // address, so pick deliberately instead of taking any one.
                        let address = best_address(&svc.addresses);
                        let txt = |k: &str| {
                            svc.txt_properties
                                .get_property_val_str(k)
                                .map(|s| s.to_string())
                        };
                        let mut guard = inner.lock().unwrap();
                        let is_self = guard.own_fullname.as_deref() == Some(svc.fullname.as_str());
                        let peer = Peer {
                            id: svc.fullname.clone(),
                            name: txt("name").unwrap_or_else(|| instance_of(&svc.fullname)),
                            address,
                            port: svc.port,
                            croc_version: txt("croc"),
                            code: txt("code").filter(|c| c.len() >= 6),
                            is_self,
                        };
                        guard.peers.insert(svc.fullname.clone(), peer);
                    }
                    mdns_sd::ServiceEvent::ServiceRemoved(_ty, fullname) => {
                        inner.lock().unwrap().peers.remove(&fullname);
                    }
                    _ => {}
                }
            }
            inner.lock().unwrap().browsing = false;
        });
        Ok(())
    }

    /// Become discoverable: advertise this device along with the one-time `code` it is
    /// waiting on. Senders read the code straight off mDNS — that's the whole handshake,
    /// which is why being discoverable IS the consent step. Re-advertises if already on
    /// (e.g. the code rotated for a new transfer).
    pub fn set_discoverable(
        &self,
        device_name: &str,
        croc_version: &str,
        code: &str,
    ) -> Result<(), String> {
        self.start_browsing()?;
        let inner_guard = self.inner.lock().unwrap();
        let daemon = inner_guard
            .daemon
            .as_ref()
            .ok_or("discovery not started")?
            .clone();
        let previous = inner_guard.own_fullname.clone();
        drop(inner_guard);

        // Replace any prior advertisement so a rotated code doesn't linger.
        if let Some(prev) = previous {
            let _ = daemon.unregister(&prev);
        }

        let instance = sanitize_instance(device_name);
        let mut props = HashMap::new();
        props.insert("name".to_string(), device_name.to_string());
        props.insert(
            "croc".to_string(),
            croc_version.trim_start_matches('v').to_string(),
        );
        props.insert("code".to_string(), code.to_string());
        let info = mdns_sd::ServiceInfo::new(
            SERVICE_TYPE,
            &instance,
            &format!("{instance}.local."),
            "",
            NO_LISTENER_PORT,
            props,
        )
        .map_err(|e| e.to_string())?
        .enable_addr_auto();

        let fullname = info.get_fullname().to_string();
        daemon.register(info).map_err(|e| e.to_string())?;
        self.inner.lock().unwrap().own_fullname = Some(fullname);
        Ok(())
    }

    /// Stop advertising (stay browsing). The code is no longer discoverable, so nobody
    /// new can send to it.
    pub fn stop_discoverable(&self) -> Result<(), String> {
        let mut inner = self.inner.lock().unwrap();
        if let (Some(daemon), Some(fullname)) = (inner.daemon.as_ref(), inner.own_fullname.clone())
        {
            let _ = daemon.unregister(&fullname);
        }
        inner.own_fullname = None;
        Ok(())
    }
}

/// Choose the address a peer is actually reachable on. mDNS hands back every address
/// the host knows — loopback and link-local included — so rank them: routable IPv4
/// first (what a LAN transfer wants), then routable IPv6, and only then anything else.
fn best_address(addrs: &std::collections::HashSet<mdns_sd::ScopedIp>) -> String {
    let ips: Vec<std::net::IpAddr> = addrs.iter().map(|a| a.to_ip_addr()).collect();
    let rank = |ip: &std::net::IpAddr| -> u8 {
        match ip {
            std::net::IpAddr::V4(v4) if !v4.is_loopback() && !v4.is_link_local() => 0,
            std::net::IpAddr::V6(v6) if !v6.is_loopback() && !is_link_local_v6(v6) => 1,
            std::net::IpAddr::V4(v4) if !v4.is_loopback() => 2, // link-local v4
            std::net::IpAddr::V6(_) => 3,
            _ => 4, // loopback
        }
    };
    ips.iter()
        .min_by_key(|ip| (rank(ip), ip.to_string()))
        .map(|ip| ip.to_string())
        .unwrap_or_default()
}

/// `Ipv6Addr::is_unicast_link_local` is unstable, so check the fe80::/10 prefix.
fn is_link_local_v6(ip: &std::net::Ipv6Addr) -> bool {
    (ip.segments()[0] & 0xffc0) == 0xfe80
}

/// mDNS instance names can't contain dots (they'd split the label).
fn sanitize_instance(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c == '.' { '-' } else { c })
        .collect();
    if cleaned.trim().is_empty() {
        "croc-desktop".to_string()
    } else {
        cleaned
    }
}

/// "My Mac._croc._tcp.local." → "My Mac"
fn instance_of(fullname: &str) -> String {
    fullname
        .split_once("._croc.")
        .map(|(i, _)| i.to_string())
        .unwrap_or_else(|| fullname.to_string())
}
