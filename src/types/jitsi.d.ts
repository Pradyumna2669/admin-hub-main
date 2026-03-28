export {};

declare global {
  type JitsiExternalApi = {
    dispose?: () => void;
    addListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  };

  type JitsiExternalApiConstructor = new (
    domain: string,
    options: Record<string, unknown>
  ) => JitsiExternalApi;

  interface Window {
    JitsiMeetExternalAPI?: JitsiExternalApiConstructor;
  }
}
