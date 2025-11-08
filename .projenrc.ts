import { cdk8s } from 'projen';

const project = new cdk8s.Cdk8sTypeScriptApp({
  name: 'cdk8s-mailu',
  defaultReleaseBranch: 'main',
  projenrcTs: true,

  // CDK8S configuration
  cdk8sVersion: '2.68.0',

  // Dependencies
  deps: [
    'cdk8s-plus-28',
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
});

// Add custom tasks
project.addTask('synth:example', {
  description: 'Synthesize example deployment',
  exec: 'ts-node examples/simple-deployment.ts',
});

project.synth();
