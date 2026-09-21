import { GenerateContentForm } from "@/components/dashboard/generate-content-form";

export default function DashboardAiPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">AI-функции</h1>
        <p className="text-muted-foreground">Сгенерируйте контент с помощью AI</p>
      </div>

      <GenerateContentForm />
    </div>
  );
}
