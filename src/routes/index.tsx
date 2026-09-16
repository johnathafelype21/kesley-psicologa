import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tela em branco" },
      {
        name: "description",
        content: "Página em branco, sem conteúdo.",
      },
      { property: "og:title", content: "Tela em branco" },
      {
        property: "og:description",
        content: "Página em branco, sem conteúdo.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div
      className="min-h-screen w-full"
      style={{ backgroundColor: "#ffffff" }}
      aria-label="Tela em branco"
    />
  );
}
