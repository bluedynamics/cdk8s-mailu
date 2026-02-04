/**
 * Mailu component constructs
 */

// Core components
export { AdminConstruct, AdminConstructProps } from './admin-construct';
export { FrontConstruct, FrontConstructProps } from './front-construct';
export { PostfixConstruct, PostfixConstructProps } from './postfix-construct';
export { DovecotConstruct, DovecotConstructProps } from './dovecot-construct';
export { RspamdConstruct, RspamdConstructProps } from './rspamd-construct';

// Optional components
export { WebmailConstruct, WebmailConstructProps } from './webmail-construct';
export { ClamavConstruct, ClamavConstructProps } from './clamav-construct';
export { FetchmailConstruct, FetchmailConstructProps } from './fetchmail-construct';
export { WebdavConstruct, WebdavConstructProps } from './webdav-construct';

// Supporting components
export { DovecotSubmissionConstruct, DovecotSubmissionConstructProps } from './dovecot-submission-construct';
export { WebmailAuthProxyConstruct, WebmailAuthProxyConstructProps } from './webmail-auth-proxy-construct';
export { WebmailAuthProxyConfigMap, WebmailAuthProxyConfigMapProps } from './webmail-auth-proxy-configmap';
export { UnboundConfigMap, UnboundConfigMapProps } from './unbound-configmap';

// Ingress components (optional)
export { TraefikIngressConstruct, TraefikIngressConstructProps } from './traefik-ingress-construct';
