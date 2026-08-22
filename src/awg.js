import { exec } from "node:child_process";
import { promisify } from "node:util";
import zlib from "node:zlib";

const run = promisify(exec);

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function inContainer(server, cmd) {
  const dockerCmd = `docker exec ${shellQuote(server.container)} sh -c "${cmd.replace(/"/g, '\\"')}"`;
  const b64 = Buffer.from(dockerCmd, "utf-8").toString("base64");
  const wrapped = `echo ${b64} | base64 -d | sh`;

  const fullCmd = server.ssh_host
    ? `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -i ${shellQuote(server.ssh_key_path)} ${shellQuote(server.ssh_user || "root")}@${shellQuote(server.ssh_host)} "${wrapped}"`
    : wrapped;

  const { stdout, stderr } = await run(fullCmd);
  if (stderr && stderr.trim()) {
    console.warn("[awg] stderr:", stderr.trim());
  }
  return stdout.trim();
}

export async function generateKeypair(server) {
  const privateKey = await inContainer(server, `awg genkey`);
  const publicKey = await inContainer(server, `echo '${privateKey}' | awg pubkey`);
  return { privateKey, publicKey };
}

export async function generatePresharedKey(server) {
  return inContainer(server, `awg genpsk`);
}

export async function syncPeers(peers, server) {
  const configPath = shellQuote(server.config_path);
  const rawContent = await inContainer(server, `cat ${configPath}`);
  const idx = rawContent.indexOf("[Peer]");
  const fullInterfaceBlock = (idx === -1 ? rawContent : rawContent.slice(0, idx)).trimEnd();

  const allowedKeys = [
    "PrivateKey", "ListenPort", "FwMark",
    "Jc", "Jmin", "Jmax", "S1", "S2", "S3", "S4", "H1", "H2", "H3", "H4",
  ];
  const syncInterfaceBlock = fullInterfaceBlock
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed === "[Interface]") return true;
      const key = trimmed.split("=")[0]?.trim();
      return allowedKeys.includes(key);
    })
    .join("\n");

  const peerBlocks = peers
    .filter((p) => !p.blocked)
    .map(
      (p) =>
        `[Peer]\nPublicKey = ${p.publicKey}\nPresharedKey = ${p.presharedKey}\nAllowedIPs = ${p.address}/32`
    )
    .join("\n\n");

  const syncPath = `${server.config_path}.sync`;
  const syncPathQuoted = shellQuote(syncPath);
  const syncContent = `${syncInterfaceBlock}\n\n${peerBlocks}\n`;
  const syncB64 = Buffer.from(syncContent, "utf-8").toString("base64");
  await inContainer(server, `echo '${syncB64}' | base64 -d > ${syncPathQuoted}`);
  await inContainer(server, `awg syncconf ${shellQuote(server.interface)} ${syncPathQuoted}`);

  const diskContent = `${fullInterfaceBlock}\n\n${peerBlocks}\n`;
  const diskB64 = Buffer.from(diskContent, "utf-8").toString("base64");
  const tmpPath = shellQuote(`${server.config_path}.tmp`);
  await inContainer(
    server,
    `echo '${diskB64}' | base64 -d > ${tmpPath} && mv ${tmpPath} ${configPath}`
  );
}

export async function getPeerStats(server) {
  const out = await inContainer(server, `awg show ${shellQuote(server.interface)} dump`);
  const lines = out.split("\n").filter(Boolean);
  const peerLines = lines.slice(1);
  return peerLines.map((line) => {
    const parts = line.split("\t");
    const [publicKey, , , allowedIps, latestHandshake, rx, tx] = parts;
    return {
      publicKey,
      allowedIps,
      lastHandshake: Number(latestHandshake) || 0,
      rxBytes: Number(rx) || 0,
      txBytes: Number(tx) || 0,
    };
  });
}

export function buildClientConfig(peer, server) {
  const dns = server.client_dns || "1.1.1.1";
  return `[Interface]
PrivateKey = ${peer.privateKey}
Address = ${peer.address}/32
DNS = ${dns}
Jc = ${server.jc}
Jmin = ${server.jmin}
Jmax = ${server.jmax}
S1 = ${server.s1}
S2 = ${server.s2}
S3 = ${server.s3}
S4 = ${server.s4}
H1 = ${server.h1}
H2 = ${server.h2}
H3 = ${server.h3}
H4 = ${server.h4}

[Peer]
PublicKey = ${server.public_key}
PresharedKey = ${peer.presharedKey}
AllowedIPs = 0.0.0.0/0
Endpoint = ${server.endpoint}
PersistentKeepalive = 25
`;
}

export function buildAmneziaVpnLink(peer, server) {
  const [host, port] = server.endpoint.split(":");
  const description = server.name || "VPN";

  const { jc: Jc, jmin: Jmin, jmax: Jmax, s1: S1, s2: S2, s3: S3, s4: S4, h1: H1, h2: H2, h3: H3, h4: H4 } = server;
  const I1 =
    "<r 2><b 0x858000010001000000000669636c6f756403636f6d0000010001c00c000100010000105a00044d583737>";

  const clientIp = peer.address.split("/")[0];
  const configText = `[Interface]
Address = ${peer.address}
DNS = $PRIMARY_DNS, $SECONDARY_DNS
PrivateKey = ${peer.privateKey}
Jc = ${Jc}
Jmin = ${Jmin}
Jmax = ${Jmax}
S1 = ${S1}
S2 = ${S2}
S3 = ${S3}
S4 = ${S4}
H1 = ${H1}
H2 = ${H2}
H3 = ${H3}
H4 = ${H4}
I1 = ${I1}
I2 =
I3 =
I4 =
I5 =

[Peer]
PublicKey = ${server.public_key}
PresharedKey = ${peer.presharedKey}
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = ${host}:${port}
PersistentKeepalive = 25
`;

  const lastConfigObj = {
    H1, H2, H3, H4, I1, Jc, Jmax, Jmin, S1, S2, S3, S4,
    allowed_ips: ["0.0.0.0/0", "::/0"],
    clientId: peer.publicKey,
    client_ip: clientIp,
    client_priv_key: peer.privateKey,
    client_pub_key: peer.publicKey,
    config: configText,
    hostName: host,
    mtu: "1376",
    persistent_keep_alive: "25",
    port: Number(port),
    psk_key: peer.presharedKey,
    server_pub_key: server.public_key,
  };

  const payload = {
    containers: [
      {
        container: "amnezia-awg2",
        awg: {
          H1, H2, H3, H4, I1, I2: "", I3: "", I4: "", I5: "",
          Jc, Jmax, Jmin, S1, S2, S3, S4,
          last_config: JSON.stringify(lastConfigObj),
          port: String(port),
          protocol_version: "2",
          transport_proto: "udp",
        },
      },
    ],
    defaultContainer: "amnezia-awg2",
    description,
    dns1: server.client_dns || "1.1.1.1",
    dns2: server.client_dns_secondary || "1.0.0.1",
    hostName: host,
  };

  const json = JSON.stringify(payload);
  const uncompressed = Buffer.from(json, "utf-8");

  const lengthHeader = Buffer.alloc(4);
  lengthHeader.writeUInt32BE(uncompressed.length, 0);
  const compressed = zlib.deflateSync(uncompressed, { level: 8 });
  const full = Buffer.concat([lengthHeader, compressed]);

  return `vpn://${full.toString("base64url")}`;
}
