import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Kesley | Psicologia e Saude Emocional" },
      {
        name: "description",
        content:
          "Um espaco de acolhimento, escuta e cuidado para transformar a sua relacao com as emocoes.",
      },
      { property: "og:title", content: "Kesley | Psicologia e Saude Emocional" },
      {
        property: "og:description",
        content:
          "Um espaco de acolhimento, escuta e cuidado para transformar a sua relacao com as emocoes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="fixed inset-0 h-dvh w-screen overflow-hidden bg-[#f7f3ea]">
      <iframe
        className="h-full w-full border-0"
        src="/landing/index.html"
        title="Kesley - Psicologia e Saude Emocional"
      />
    </main>
  );
}
