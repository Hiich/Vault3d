import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";

/**
 * Derive EVM addresses from a BIP39 mnemonic using MetaMask's BIP44 path.
 * Returns one address per account index: m/44'/60'/0'/0/{i}
 */
export function deriveAddressesFromMnemonic(
  mnemonic: string,
  accountCount: number
): string[] {
  const addresses: string[] = [];
  for (let i = 0; i < accountCount; i++) {
    const account = mnemonicToAccount(mnemonic, {
      addressIndex: i,
    });
    addresses.push(account.address);
  }
  return addresses;
}

/**
 * Derive an EVM address from a hex private key (0x-prefixed or not).
 */
export function deriveAddressFromPrivateKey(hexKey: string): string {
  const key = hexKey.startsWith("0x")
    ? (hexKey as `0x${string}`)
    : (`0x${hexKey}` as `0x${string}`);
  const account = privateKeyToAccount(key);
  return account.address;
}
