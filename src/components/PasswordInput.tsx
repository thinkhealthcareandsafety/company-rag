"use client";

import { useState } from "react";
import { EyeIcon, EyeOffIcon } from "@/components/icons";

export function PasswordInput({
  id,
  value,
  onChange,
  required,
  minLength,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  minLength?: number;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div style={{ position: "relative" }}>
      <input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        minLength={minLength}
        style={{ width: "100%", paddingRight: "2.5rem" }}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        style={{
          position: "absolute",
          top: "50%",
          right: "0.6rem",
          transform: "translateY(-50%)",
          width: "26px",
          height: "26px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "none",
          background: "none",
          color: "var(--text-faint)",
          cursor: "pointer",
        }}
      >
        <span style={{ width: 18, height: 18, display: "block" }}>{visible ? <EyeOffIcon /> : <EyeIcon />}</span>
      </button>
    </div>
  );
}
