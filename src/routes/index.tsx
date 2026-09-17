import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Kesley Lilian | Psicologia e Saúde Emocional" },
      {
        name: "description",
        content:
          "Um espaço de acolhimento, escuta e cuidado para transformar a sua relação com as emoções.",
      },
      { property: "og:title", content: "Kesley Lilian | Psicologia e Saúde Emocional" },
      {
        property: "og:description",
        content:
          "Um espaço de acolhimento, escuta e cuidado para transformar a sua relação com as emoções.",
      },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "/og-image.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "/og-image.jpg" },
    ],
  }),
  component: Index,
});

function Index() {
  useEffect(() => {
    // The scroll-driven landing must run as the top document, not inside a
    // nested iframe. Lovable already renders previews inside an iframe, so an
    // additional iframe here breaks wheel/touch scrolling in some browsers.
    window.location.replace("/landing/index.html");
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f3ea] px-6 text-center text-[#1a1d1a]">
      <div>
        <p className="text-sm">Carregando experiência...</p>
        <a className="mt-3 inline-block underline" href="/landing/index.html">
          Abrir site
        </a>
      </div>
    </main>
  );
}
