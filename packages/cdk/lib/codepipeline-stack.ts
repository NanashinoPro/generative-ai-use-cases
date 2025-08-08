import * as cdk from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { ProcessedStackInput } from './stack-input';

export interface CodePipelineStackProps extends cdk.StackProps {
  params: ProcessedStackInput;
}

export class CodePipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CodePipelineStackProps) {
    super(scope, id, props);

    const { params } = props;

    if (!params.githubConnectionArn || !params.githubRepoOwner || !params.githubRepoName) {
      throw new Error('GitHub connection ARN, repository owner, and repository name are required for CodePipeline');
    }

    // Create CodeBuild Project
    const buildProject = new codebuild.Project(this, 'BuildProject', {
      projectName: `GenU-Build${params.env}`,
      source: codebuild.Source.gitHub({
        owner: params.githubRepoOwner,
        repo: params.githubRepoName,
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            'runtime-versions': {
              nodejs: '20',
            },
          },
          build: {
            commands: [
              'npm ci',
              'npm run cdk:deploy:quick',
            ],
          },
        },
      }),
      role: new iam.Role(this, 'BuildRole', {
        assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLogsFullAccess'),
        ],
        inlinePolicies: {
          CDKDeployPolicy: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['sts:AssumeRole'],
                resources: ['*'],
                conditions: {
                  'ForAnyValue:StringEquals': {
                    'iam:ResourceTag/aws-cdk:bootstrap-role': [
                      'image-publishing',
                      'file-publishing',
                      'deploy',
                      'lookup',
                    ],
                  },
                },
              }),
            ],
          }),
        },
      }),
    });

    // Create artifacts
    const sourceOutput = new codepipeline.Artifact();
    const buildOutput = new codepipeline.Artifact();

    // Create CodePipeline
    const pipeline = new codepipeline.Pipeline(this, 'Pipeline', {
      pipelineName: `GenU-Pipeline${params.env}`,
      stages: [
        {
          stageName: 'Source',
          actions: [
            new codepipeline_actions.CodeStarConnectionsSourceAction({
              actionName: 'GitHub_Source',
              owner: params.githubRepoOwner,
              repo: params.githubRepoName,
              branch: params.githubBranch,
              connectionArn: params.githubConnectionArn,
              output: sourceOutput,
            }),
          ],
        },
        {
          stageName: 'Build',
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: 'Build_Deploy',
              project: buildProject,
              input: sourceOutput,
              outputs: [buildOutput],
            }),
          ],
        },
      ],
    });

    // Output pipeline name
    new cdk.CfnOutput(this, 'PipelineName', {
      value: pipeline.pipelineName,
      description: 'CodePipeline name',
    });

    new cdk.CfnOutput(this, 'BuildProjectName', {
      value: buildProject.projectName,
      description: 'CodeBuild project name',
    });
  }
}