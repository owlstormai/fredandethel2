// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";

afterEach(cleanup);

function Harness({ onClose, open = true }: { onClose: () => void; open?: boolean }) {
  return (
    <>
      <button type="button">Opener</button>
      <Dialog
        open={open}
        onClose={onClose}
        title="Forget this for good?"
        description="This cannot be undone."
        actions={
          <>
            <Button data-testid="keep">Keep it</Button>
            <Button variant="danger" data-testid="forget">
              Forget it
            </Button>
          </>
        }
      />
    </>
  );
}

describe("<Dialog />", () => {
  it("renders an aria-modal dialog labelled by its title and described by its text", () => {
    render(<Harness onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Forget this for good?");
    expect(dialog).toHaveAccessibleDescription("This cannot be undone.");
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("moves focus inside, closes on Escape and restores focus", async () => {
    const onClose = vi.fn();
    const { rerender } = render(<Harness onClose={onClose} open={false} />);
    const opener = screen.getByText("Opener");
    opener.focus();
    rerender(<Harness onClose={onClose} open />);
    await waitFor(() => expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true));
    expect(document.activeElement).toBe(screen.getByTestId("keep"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<Harness onClose={onClose} open={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("traps Tab within the dialog", async () => {
    render(<Harness onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true));
    const forget = screen.getByTestId("forget");
    forget.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    // wrapped from the last focusable to the first (the close button)
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close dialog" }));
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(forget);
  });

  it("does not close while locked", () => {
    const onClose = vi.fn();
    render(<Dialog open onClose={onClose} title="Working" locked />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
