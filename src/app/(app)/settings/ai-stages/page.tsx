import { AiStageSettings } from "@/features/settings/components/ai-stage-settings"

export default function AiStagesPage() {
  return <div className="space-y-6"><div><h2 className="text-2xl font-bold">AI by stage</h2><p className="mt-1 text-sm text-muted-foreground">Choose which provider prepares each part of your job search.</p></div><AiStageSettings /></div>
}
