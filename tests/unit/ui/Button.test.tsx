// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button, LinkButton } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";

afterEach(cleanup);

describe("<Button />", () => {
  it("renders a native button with testid passthrough and fires onClick", () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" size="xl" onClick={onClick} data-testid="cta">
        Start
      </Button>,
    );
    const btn = screen.getByTestId("cta");
    expect(btn.tagName).toBe("BUTTON");
    expect(btn).toHaveAttribute("type", "button");
    expect(btn).toHaveTextContent("Start");
    expect(btn.className).toMatch(/min-h-14/);
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is disabled and announces busy while loading", () => {
    const onClick = vi.fn();
    render(
      <Button loading loadingLabel="Saving" onClick={onClick}>
        Save
      </Button>,
    );
    const btn = screen.getByRole("button", { name: /Saving/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("meets the 48px minimum target at size lg", () => {
    render(<Button size="lg">Ok</Button>);
    expect(screen.getByRole("button").className).toMatch(/min-h-12/);
  });

  it("renders LinkButton as an anchor with href", () => {
    render(
      <LinkButton href="/login" variant="secondary" data-testid="cta-signin">
        Sign in
      </LinkButton>,
    );
    const link = screen.getByTestId("cta-signin");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/login");
  });
});

describe("<IconButton />", () => {
  it("always has an accessible name and supports pressed state", () => {
    render(<IconButton label="Mute microphone" icon={<svg />} pressed />);
    const btn = screen.getByRole("button", { name: "Mute microphone" });
    expect(btn).toHaveAttribute("aria-pressed", "true");
    expect(btn.className).toMatch(/size-12/);
  });
});
