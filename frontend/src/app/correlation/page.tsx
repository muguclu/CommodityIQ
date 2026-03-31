import { Link2 } from "lucide-react";
import PlaceholderPage from "@/components/ui/PlaceholderPage";

export default function CorrelationPage() {
  return (
    <PlaceholderPage
      title="Correlation"
      icon={Link2}
      description="Dynamic correlation matrices between commodities, FX pairs, equities, and macro indicators with rolling-window analysis."
      phase={3}
      features={[
        "Pearson, Spearman, and Kendall correlation matrices",
        "Rolling window correlation with adjustable lookback",
        "Interactive heatmap with hierarchical clustering",
        "Cross-asset correlation between commodities, FX, and rates",
        "Correlation regime detection and breakpoint analysis",
      ]}
      color="text-indigo-400"
      borderColor="border-indigo-500/20"
      bgColor="bg-indigo-500/5"
    />
  );
}
