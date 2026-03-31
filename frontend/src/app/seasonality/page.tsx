import { Thermometer } from "lucide-react";
import PlaceholderPage from "@/components/ui/PlaceholderPage";

export default function SeasonalityPage() {
  return (
    <PlaceholderPage
      title="Seasonality"
      icon={Thermometer}
      description="Decompose seasonal patterns, detect cyclical trends, and visualize intraday, weekly, and annual rhythms in commodity prices."
      phase={2}
      features={[
        "STL decomposition (trend, seasonal, residual components)",
        "Monthly and weekly seasonality heatmaps",
        "Rolling seasonal index computation",
        "Fourier-based periodicity detection",
        "Year-over-year overlay charts for multi-year comparison",
      ]}
      color="text-teal-400"
      borderColor="border-teal-500/20"
      bgColor="bg-teal-500/5"
    />
  );
}
