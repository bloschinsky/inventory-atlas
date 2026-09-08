export const roles = ['viewer', 'editor', 'owner', 'admin'] as const;
export type Role = (typeof roles)[number];
export type ActorRole = Role | 'public';

export const capabilities = [
  'viewPublicCards',
  'viewAuthenticatedFields',
  'viewPrivateFields',
  'editItems',
  'moveInventory',
  'manageSchema',
  'manageUsers',
  'manageSettings',
  'managePortability',
  'manageIntegrations',
  'searchPrivateValues',
  'manageAudit',
  'manageJobs',
] as const;
export type Capability = (typeof capabilities)[number];

export interface AuthorizationSettings {
  publicCatalogEnabled?: boolean;
  adminGrants?: readonly Extract<
    Capability,
    | 'manageUsers'
    | 'manageSettings'
    | 'managePortability'
    | 'manageIntegrations'
    | 'manageAudit'
    | 'manageJobs'
  >[];
}

const viewer = new Set<Capability>(['viewPublicCards', 'viewAuthenticatedFields']);
const editor = new Set<Capability>([...viewer, 'editItems', 'moveInventory']);
const owner = new Set<Capability>(capabilities);
const adminBase = new Set<Capability>([
  ...editor,
  'viewPrivateFields',
  'manageSchema',
  'searchPrivateValues',
]);

export function permissionsFor(
  role: ActorRole,
  settings: AuthorizationSettings = {},
): readonly Capability[] {
  if (role === 'public') return settings.publicCatalogEnabled ? ['viewPublicCards'] : [];
  if (role === 'viewer') return [...viewer];
  if (role === 'editor') return [...editor];
  if (role === 'owner') return [...owner];
  return [
    ...new Set([
      ...adminBase,
      ...(settings.adminGrants ?? (['manageUsers', 'manageSettings'] as const)),
    ]),
  ];
}

export function can(
  role: ActorRole,
  capability: Capability,
  settings: AuthorizationSettings = {},
): boolean {
  return permissionsFor(role, settings).includes(capability);
}

export function canManageRole(actorRole: Role, targetRole: Role): boolean {
  return actorRole === 'owner' || (actorRole === 'admin' && targetRole !== 'owner');
}
