import { Bot } from "lucide-react";
import PlaceholderPage from "@/components/ui/PlaceholderPage";

export default function ChatPage() {
  return (
    <PlaceholderPage
      title="AI Chat"
      icon={Bot}
      description="Ask natural language questions about your commodity data, market trends, and analytics results. Powered by Claude AI."
      phase={3}
      features={[
        "Natural language queries over loaded datasets",
        "Contextual awareness of current charts and analysis",
        "Automated insight generation from regression/forecast outputs",
        "Export AI-generated summaries as PDF reports",
        "Multi-turn conversation with memory of analysis session",
      ]}
      color="text-emerald-400"
      borderColor="border-emerald-500/20"
      bgColor="bg-emerald-500/5"
    />
  );
}
