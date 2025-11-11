import { cdk8s, github } from 'projen';

const project = new cdk8s.Cdk8sTypeScriptApp({
  name: 'cdk8s-mailu',
  defaultReleaseBranch: 'main',
  projenrcTs: true,

  // CDK8S configuration
  cdk8sVersion: '2.70.26',

  // Dependencies
  deps: [
    'cdk8s-plus-33@^2.4.0',
  ],
  devDeps: [
    '@types/node',
  ],

  // Package configuration
  packageName: 'cdk8s-mailu',

  // Disable sample code (we'll create our own)
  sampleCode: false,

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

// Package.json configuration for library usage
project.package.addField('main', 'lib/index.js');
project.package.addField('types', 'lib/index.d.ts');

// Custom tasks
project.addTask('synth:example', {
  description: 'Synthesize example deployment',
  exec: 'ts-node examples/simple-deployment.ts',
});

project.synth();
