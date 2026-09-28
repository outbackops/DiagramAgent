import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import DeviceFlowDialog from "./DeviceFlowDialog";
import { api } from "@/lib/client/api";

vi.mock("@/lib/client/api", () => ({
  api: { startDeviceFlow: vi.fn(), pollDeviceFlow: vi.fn() },
}));

const start = vi.mocked(api.startDeviceFlow);
const poll = vi.mocked(api.pollDeviceFlow);
const START = { flow: "sealed", userCode: "ABCD-1234", verificationUri: "https://github.com/login/device", expiresIn: 900, interval: 5 };

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  start.mockReset().mockResolvedValue(START);
  poll.mockReset().mockResolvedValue({ status: "pending" });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("DeviceFlowDialog", () => {
  it("keeps one flow running when the parent re-renders with new callbacks", async () => {
    const { rerender } = render(<DeviceFlowDialog open onClose={() => {}} onSignedIn={() => {}} />);
    await flush();
    expect(screen.getByText("ABCD-1234")).toBeTruthy();

    rerender(<DeviceFlowDialog open onClose={() => {}} onSignedIn={() => {}} />);
    await flush(5_000);
    rerender(<DeviceFlowDialog open onClose={() => {}} onSignedIn={() => {}} />);
    await flush(5_000);

    expect(start).toHaveBeenCalledTimes(1);
    expect(poll).toHaveBeenCalledTimes(2);
    expect(screen.getByText("ABCD-1234")).toBeTruthy();
  });

  it("reports success once and then closes, using the latest callbacks", async () => {
    poll.mockResolvedValueOnce({ status: "complete", login: "octocat" });
    const firstClose = vi.fn();
    const onClose = vi.fn();
    const onSignedIn = vi.fn();
    const { rerender } = render(<DeviceFlowDialog open onClose={firstClose} onSignedIn={onSignedIn} />);
    await flush(5_000);
    expect(onSignedIn).toHaveBeenCalledTimes(1);
    expect(screen.getByText("@octocat")).toBeTruthy();

    rerender(<DeviceFlowDialog open onClose={onClose} onSignedIn={onSignedIn} />);
    await flush(1_200);
    expect(firstClose).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("stops polling when closed, even if a start request was still in flight", async () => {
    let resolveStart: (value: typeof START) => void = () => {};
    start.mockReturnValueOnce(new Promise((resolve) => (resolveStart = resolve)));
    const { rerender } = render(<DeviceFlowDialog open onClose={() => {}} onSignedIn={() => {}} />);
    rerender(<DeviceFlowDialog open={false} onClose={() => {}} onSignedIn={() => {}} />);
    resolveStart(START);
    await flush(30_000);
    expect(poll).not.toHaveBeenCalled();
  });

  it("ignores a stale start that resolves after the dialog was reopened", async () => {
    let resolveFirst: (value: typeof START) => void = () => {};
    start.mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve))).mockResolvedValueOnce({ ...START, flow: "second", userCode: "WXYZ-9876" });
    const { rerender } = render(<DeviceFlowDialog open onClose={() => {}} onSignedIn={() => {}} />);
    rerender(<DeviceFlowDialog open={false} onClose={() => {}} onSignedIn={() => {}} />);
    rerender(<DeviceFlowDialog open onClose={() => {}} onSignedIn={() => {}} />);
    await flush();
    resolveFirst(START);
    await flush(5_000);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(poll).toHaveBeenCalledWith("second");
    expect(screen.getByText("WXYZ-9876")).toBeTruthy();
  });

  it("backs off when GitHub asks it to slow down", async () => {
    poll.mockResolvedValueOnce({ status: "slow_down", interval: 10 });
    render(<DeviceFlowDialog open onClose={() => {}} onSignedIn={() => {}} />);
    await flush(5_000);
    expect(poll).toHaveBeenCalledTimes(1);
    await flush(9_000);
    expect(poll).toHaveBeenCalledTimes(1);
    await flush(1_000);
    expect(poll).toHaveBeenCalledTimes(2);
  });
});
