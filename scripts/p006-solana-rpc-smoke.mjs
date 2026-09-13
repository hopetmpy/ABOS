import http from "node:http";
import { Connection } from "@solana/web3.js";

const server = http.createServer((req, res) => {
  let body = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    let id = 1;
    try {
      const parsed = JSON.parse(body || "{}");
      id = parsed.id ?? id;
    } catch {}
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      jsonrpc: "2.0",
      id,
      result: { "solana-core": "1.18.0", "feature-set": 123 },
    }));
  });
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

try {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No TCP address");
  const connection = new Connection(`http://127.0.0.1:${address.port}`, "confirmed");
  const version = await connection.getVersion();
  if (version["solana-core"] !== "1.18.0") {
    throw new Error(`Unexpected RPC result: ${JSON.stringify(version)}`);
  }
  console.log("P006_SOLANA_RPC_SMOKE_PASS", JSON.stringify(version));
} finally {
  await new Promise((resolve) => server.close(resolve));
}
