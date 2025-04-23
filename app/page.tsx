"use client";

import React from "react";

export default function Home() {
  return (
    <main style={{ padding: "2rem", fontFamily: "Arial, sans-serif" }}>
      <h1 style={{ fontSize: "2rem", color: "#0f172a" }}>
        👋 Добро пожаловать в фабрику кода Vlaskov
      </h1>
      <p style={{ marginTop: "1rem", fontSize: "1.2rem", color: "#475569" }}>
        Этот сервис автоматически создает Pull Request по задачам из репозитория
        <strong> vlaskov-store</strong> с помощью OpenAI и GitHub API.
      </p>

      <section style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1.5rem", color: "#0f172a" }}>Как это работает?</h2>
        <ol style={{ marginTop: "0.5rem", paddingLeft: "1.5rem", fontSize: "1.1rem" }}>
          <li>📩 Вы создаете Issue в vlaskov-store</li>
          <li>🧠 Бот вызывает OpenAI и получает код</li>
          <li>🔀 Генерируется ветка и PR</li>
        </ol>
      </section>

      <footer style={{ marginTop: "3rem", fontSize: "0.9rem", color: "#94a3b8" }}>
        Фабрика кода разработана с 💡 специально для автоматизации.
      </footer>
    </main>
  );
}
