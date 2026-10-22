// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Orb } from "@/components/orb/Orb";
import { OrbRenderer } from "@/components/orb/orbRenderer";

afterEach(cleanup);

describe("<Orb />", () => {
  it("exposes testids, state, levels and an aria-live status", () => {
    render(<Orb state="speaking" micLevel={0.2} outputLevel={0.6} label="Fred" size={200} reducedMotion color="violet" />);
    const orb = screen.getByTestId("orb");
    expect(orb).toHaveAttribute("data-state", "speaking");
    expect(orb).toHaveAttribute("data-color", "violet");
    expect(orb).toHaveAttribute("data-reduced-motion", "true");
    expect(orb).toHaveAttribute("data-mic-level");
    expect(orb).toHaveAttribute("data-output-level");
    expect(orb).toHaveAttribute("role", "img");
    expect(orb).toHaveAccessibleName("Fred is speaking");
    const status = screen.getByTestId("orb-status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Fred is speaking");
    expect(orb.style.width).toBe("200px");
  });

  it("defaults the color to the <html data-orb-color> attribute", () => {
    document.documentElement.setAttribute("data-orb-color", "amber");
    render(<Orb state="idle" micLevel={0} outputLevel={0} />);
    expect(screen.getByTestId("orb")).toHaveAttribute("data-color", "amber");
    document.documentElement.removeAttribute("data-orb-color");
  });

  it("updates the status text when the state changes", () => {
    const { rerender } = render(<Orb state="listening" micLevel={0} outputLevel={0} />);
    expect(screen.getByTestId("orb-status")).toHaveTextContent("Listening");
    rerender(<Orb state="muted" micLevel={0} outputLevel={0} />);
    expect(screen.getByTestId("orb")).toHaveAttribute("data-state", "muted");
    expect(screen.getByTestId("orb-status")).toHaveTextContent("Microphone is muted");
  });
});

describe("OrbRenderer", () => {
  it("is safe to drive without a 2D context (jsdom has none)", () => {
    const canvas = document.createElement("canvas");
    const renderer = new OrbRenderer(canvas);
    renderer.resize(300, 300, 2);
    expect(canvas.width).toBe(600);
    renderer.setState("listening");
    renderer.setColor("emerald");
    renderer.setReducedMotion(true);
    expect(() => renderer.frame(16, 0.5, 0)).not.toThrow();
    expect(renderer.currentState).toBe("listening");
    expect(renderer.isReducedMotion).toBe(true);
  });
});
