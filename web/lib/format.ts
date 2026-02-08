export function truncateAddress(addr: string, chars = 6): string {
  if (addr.length <= chars * 2 + 3) return addr;
  return `${addr.slice(0, chars)}...${addr.slice(-4)}`;
}

export function formatBalance(balance: string): string {
  const num = parseFloat(balance);
  if (num === 0) return "0.00";
  if (num < 0.0001) return "<0.0001";
  if (num < 1) return num.toFixed(4);
  if (num < 1000) return num.toFixed(2);
  return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr + "Z").getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function chainBadgeColor(chain: string): string {
  const colors: Record<string, string> = {
    ethereum: "bg-blue-500",
    base: "bg-blue-400",
    polygon: "bg-purple-500",
    abstract: "bg-green-500",
    solana: "bg-gradient-to-r from-purple-500 to-green-400",
  };
  return colors[chain] ?? "bg-gray-500";
}

export function typeBadgeColor(type: string): string {
  const colors: Record<string, string> = {
    metamask_hd: "bg-orange-500",
    metamask_imported: "bg-orange-400",
    phantom_seed: "bg-purple-500",
    phantom_keypair: "bg-purple-400",
  };
  return colors[type] ?? "bg-gray-500";
}

export function nativeTokenForChain(chain: string): string {
  const map: Record<string, string> = {
    ethereum: "ETH",
    base: "ETH",
    abstract: "ETH",
    polygon: "POL",
    solana: "SOL",
  };
  return map[chain] ?? chain.toUpperCase();
}
