import fs from "node:fs";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { initializeLiveRoot, LIVE_PATHS, requireRestrictedLive, RestrictedLiveViolation } from "./mode.js";

const LIVE_WALLET_FILE = path.join(LIVE_PATHS.wallet, "wallet.json");

export interface RestrictedWalletInfo { address: `0x${string}`; createdAt: string }

export function getRestrictedWalletPath(): string { return LIVE_WALLET_FILE; }

export function initializeRestrictedWallet(): RestrictedWalletInfo {
  requireRestrictedLive("initialize dedicated wallet");
  initializeLiveRoot();
  if (fs.existsSync(LIVE_WALLET_FILE)) return readRestrictedWalletInfo();
  return createRestrictedWalletAt(LIVE_WALLET_FILE, generatePrivateKey);
}

export function createRestrictedWalletAt(walletFile: string, keyGenerator: () => `0x${string}`): RestrictedWalletInfo {
  if (fs.existsSync(walletFile)) {
    const data = JSON.parse(fs.readFileSync(walletFile, "utf8"));
    return { address: data.address, createdAt: data.createdAt };
  }
  fs.mkdirSync(path.dirname(walletFile), { recursive: true, mode: 0o700 });
  const privateKey = keyGenerator();
  const account = privateKeyToAccount(privateKey);
  const data = { version: 1, chain: "base", address: account.address, privateKey, createdAt: new Date().toISOString() };
  fs.writeFileSync(walletFile, JSON.stringify(data), { encoding: "utf8", mode: 0o600, flag: "wx" });
  fs.chmodSync(walletFile, 0o600);
  return { address: account.address, createdAt: data.createdAt };
}

export function readRestrictedWalletInfo(): RestrictedWalletInfo {
  requireRestrictedLive("read dedicated wallet public identity");
  if (!fs.existsSync(LIVE_WALLET_FILE)) throw new RestrictedLiveViolation("WALLET_NOT_INITIALIZED", "Dedicated restricted-live wallet is not initialized");
  const data = JSON.parse(fs.readFileSync(LIVE_WALLET_FILE, "utf8"));
  if (data.chain !== "base" || typeof data.address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(data.address)) {
    throw new RestrictedLiveViolation("WALLET_INVALID", "Dedicated restricted-live wallet file is invalid");
  }
  return { address: data.address, createdAt: data.createdAt };
}
