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
    rabby_hd: "bg-blue-500",
    rabby_imported: "bg-blue-400",
    coinbase_hd: "bg-indigo-500",
    coinbase_imported: "bg-indigo-400",
  };
  if (colors[type]) return colors[type]!;

  // Deterministic fallback: hash the slug prefix to pick a color
  const FALLBACK_COLORS = [
    "bg-teal-500", "bg-cyan-500", "bg-emerald-500", "bg-rose-500",
    "bg-amber-500", "bg-lime-500", "bg-fuchsia-500", "bg-sky-500",
  ];
  const slug = type.split("_")[0] ?? type;
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = ((hash << 5) - hash + slug.charCodeAt(i)) | 0;
  }
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length]!;
}

export function abbreviateWalletType(type: string): string {
  const known: Record<string, string> = {
    metamask: "mm",
    phantom: "ph",
    rabby: "rb",
    coinbase: "cb",
  };
  const parts = type.split("_");
  const slug = parts[0] ?? type;
  const suffix = parts.slice(1).join("_");
  const abbr = known[slug] ?? slug.slice(0, 3);
  return suffix ? `${abbr}:${suffix}` : abbr;
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
