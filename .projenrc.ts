import { cdk8s } from 'projen';

const project = new cdk8s.Cdk8sTypeScriptApp({
  name: 'cdk8s-mailu',
  description: 'CDK8S construct library for deploying Mailu mail server to Kubernetes',
  repositoryUrl: 'https://github.com/bluedynamics/cdk8s-mailu.git',
  author: 'Blue Dynamics Alliance',
  authorAddress: 'dev@bluedynamics.com',
  license: 'Apache-2.0',
  licensed: true,

  defaultReleaseBranch: 'main',
  projenrcTs: true,

  // CDK8S configuration
  cdk8sVersion: '2.68.0',
  cdk8sPlusVersion: '28.0.0',

  // Dependencies
  deps: [
    'cdk8s-plus-28',
  ],
  devDeps: [
    '@types/node',
  ],

  // TypeScript configuration
  tsconfig: {
    compilerOptions: {
      lib: ['ES2021'],
      target: 'ES2021',
      module: 'CommonJS',
      moduleResolution: 'node',
      esModuleInterop: true,
      skipLibCheck: true,
      strict: true,
      noImplicitAny: true,
      strictNullChecks: true,
      strictFunctionTypes: true,
      strictPropertyInitialization: true,
      noImplicitThis: true,
      alwaysStrict: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
      noImplicitReturns: true,
      noFallthroughCasesInSwitch: true,
    },
  },

  // GitHub configuration
  github: true,
  githubOptions: {
    pullRequestLintOptions: {
      semanticTitleOptions: {
        types: ['feat', 'fix', 'chore', 'docs', 'style', 'refactor', 'test', 'ci'],
      },
    },
  },

  // Release configuration
  releaseToNpm: true,
  npmAccess: 'public' as any,

  // Package configuration
  keywords: [
    'cdk8s',
    'kubernetes',
    'k8s',
    'mailu',
    'mail',
    'email',
    'smtp',
    'imap',
    'webmail',
    'constructs',
  ],

  // Build configuration
  buildWorkflow: true,
  release: true,

  // Disable Python/Java publishing (TypeScript only for now)
  publishToPypi: undefined,
  publishToMaven: undefined,
  publishToGo: undefined,
  publishToNuget: undefined,

  // Documentation
  docgen: true,

  // Sample code
  sampleCode: false, // We'll create our own structure

  // Git ignore
  gitignore: [
    'dist/',
    '.env',
    '.env.*',
    '!.env.example',
    'cdk.out/',
    '*.log',
  ],
});

// Add example task
project.addTask('synth:example', {
  description: 'Synthesize example deployment',
  exec: 'ts-node examples/simple-deployment.ts',
});

project.synth();
