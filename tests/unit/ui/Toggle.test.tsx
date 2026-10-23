// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Toggle } from "@/components/ui/Toggle";

afterEach(cleanup);

describe("<Toggle />", () => {
  it("is a switch with aria-checked, a label and a description", () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Remember things about me" description="Only what you agree to." data-testid="pref-memory" />);
    const sw = screen.getByRole("switch", { name: "Remember things about me" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(sw).toHaveAccessibleDescription("Only what you agree to.");
    expect(sw).toHaveAttribute("data-testid", "pref-memory");
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("reflects checked state and is keyboard reachable", () => {
    render(<Toggle checked onChange={() => {}} label="Captions" />);
    const sw = screen.getByRole("switch");
    expect(sw).toHaveAttribute("aria-checked", "true");
    expect(sw.tagName).toBe("BUTTON"); // native button: Space/Enter activate it
    expect(sw).not.toHaveAttribute("tabindex", "-1");
    expect(sw).not.toBeDisabled();
    expect(sw).toHaveTextContent("On");
  });

  it("clicking the visible label activates the switch", () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Look things up" />);
    fireEvent.click(screen.getByText("Look things up"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("does nothing when disabled", () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Off" disabled />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("<SegmentedControl />", () => {
  const options = [
    { value: "off", label: "Off" },
    { value: "gentle", label: "Gentle" },
    { value: "playful", label: "Playful" },
  ] as const;

  it("uses radiogroup semantics with one tab stop", () => {
    render(<SegmentedControl label="Humor" value="gentle" options={options} onChange={() => {}} optionTestId={(v) => `pref-humor-${v}`} />);
    expect(screen.getByRole("radiogroup", { name: "Humor" })).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(screen.getByTestId("pref-humor-gentle")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("pref-humor-gentle")).toHaveAttribute("tabindex", "0");
    expect(screen.getByTestId("pref-humor-off")).toHaveAttribute("tabindex", "-1");
  });

  it("moves selection with arrow keys and Home/End", () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="Humor" value="gentle" options={options} onChange={onChange} optionTestId={(v) => `pref-humor-${v}`} />);
    const gentle = screen.getByTestId("pref-humor-gentle");
    gentle.focus();
    fireEvent.keyDown(gentle, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("playful");
    expect(document.activeElement).toBe(screen.getByTestId("pref-humor-playful"));
    fireEvent.keyDown(screen.getByTestId("pref-humor-playful"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("off"); // wraps
    fireEvent.keyDown(gentle, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("off");
    fireEvent.keyDown(gentle, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("playful");
  });

  it("selects on click", () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="Humor" value="off" options={options} onChange={onChange} optionTestId={(v) => `pref-humor-${v}`} />);
    fireEvent.click(screen.getByTestId("pref-humor-playful"));
    expect(onChange).toHaveBeenCalledWith("playful");
  });
});
