declare module "@echogarden/fvad-wasm" {
  interface FvadModule {
    _fvad_new(): number;
    _fvad_free(handle: number): void;
    _fvad_reset(handle: number): void;
    _fvad_set_mode(handle: number, mode: number): number;
    _fvad_set_sample_rate(handle: number, rate: number): number;
    _fvad_process(handle: number, framePtr: number, length: number): number;
    _malloc(bytes: number): number;
    _free(ptr: number): void;
    HEAP16: Int16Array;
  }
  const createFvad: () => Promise<FvadModule>;
  export default createFvad;
}
