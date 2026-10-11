/** Any RPC call the keeper's own Ethereum provider makes gives up after this, so a hung connection can't stall a send. */
export const RPC_TIMEOUT_MS = 30_000;
