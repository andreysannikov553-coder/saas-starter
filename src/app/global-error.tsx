"use client";

/**
 * Last-resort boundary: catches errors thrown in the root layout, where the
 * normal error boundary has no shell to render into. It must supply its own
 * <html> and <body>.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ru">
      <body
        style={{
          display: "flex",
          minHeight: "100vh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          fontFamily: "system-ui, sans-serif",
          padding: "1.5rem",
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700 }}>Приложение не отвечает</h1>
        <p style={{ color: "#666", maxWidth: "28rem" }}>
          Произошла непредвиденная ошибка. Попробуйте перезагрузить страницу.
        </p>
        <button
          onClick={reset}
          style={{
            cursor: "pointer",
            borderRadius: "0.5rem",
            border: "1px solid #ddd",
            padding: "0.5rem 1rem",
          }}
        >
          Перезагрузить
        </button>
        {error.digest ? (
          <p style={{ color: "#999", fontSize: "0.75rem" }}>Код ошибки: {error.digest}</p>
        ) : null}
      </body>
    </html>
  );
}
