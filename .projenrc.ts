import { typescript, github } from 'projen';

const project = new typescript.TypeScriptProject({
  name: 'cdk8s-mailu',
  defaultReleaseBranch: 'main',
  projenrcTs: true,

  // Package metadata
  packageName: 'cdk8s-mailu',
  authorName: 'KUP6S Team',
  authorEmail: 'team@kup6s.com',
  repository: 'https://git.bluedynamics.eu/kup6s/workspace-kup6s.git',
  license: 'Apache-2.0',

  // CDK8S Dependencies
  peerDeps: [
    'cdk8s@^2.70.26',
    'cdk8s-plus-33@^2.4.0',
    'constructs@^10.4.0', // Updated to match workspace
  ],
  devDeps: [
    '@types/node',
    'cdk8s@^2.70.26',
    'cdk8s-plus-33@^2.4.0',
    'constructs@^10.4.0', // Updated to match workspace
    'cdk8s-cli', // For CRD imports
  ],

  // Git ignore additions
  gitignore: [
    'dist/',
    '.env',
    '.env.*',
    '!.env.example',
    'cdk.out/',
    '*.log',
  ],

  // Configure upgrade workflow to use GITHUB_TOKEN instead of PAT
  depsUpgrade: true,
  depsUpgradeOptions: {
    workflowOptions: {
      projenCredentials: github.GithubCredentials.fromPersonalAccessToken({
        secret: 'GITHUB_TOKEN',
      }),
    },
  },
});

// Custom tasks
project.addTask('synth:example', {
  description: 'Synthesize example deployment',
  exec: 'ts-node examples/simple-deployment.ts',
});

// Task to import CRDs (for updates)
project.addTask('import:crds', {
  description: 'Import Kubernetes CRDs (Traefik, Prometheus)',
  exec: 'cdk8s import k8s && cdk8s import crds/traefik-crds.yaml && cdk8s import crds/prometheus-servicemonitor-crd.yaml',
});

project.synth();
