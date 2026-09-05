/** Public backend surface. Feature modules export only deliberate entry points here. */
export function foundationStatus(): { status: string } {
  return { status: 'ready' };
}
