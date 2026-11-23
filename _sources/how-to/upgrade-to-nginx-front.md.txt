# Upgrade to the nginx front

This guide shows you how to upgrade a deployment from cdk8s-mailu 0.4 or earlier to 0.5.
Version 0.5 replaces the Mailu front image with the official nginx image.
For the reasons, see [The front mail proxy](../explanation/front-mail-proxy.md).

(upgrade-front-what-changes)=

## What changes in the manifests

- The front Deployment runs `nginx:1.30.7-alpine` as user 101 and gets no environment.
- The front container listens on 10465, 10993, and 10995.
  The Service keeps the ports 465, 993, and 995 and targets the new container ports.
- A new ConfigMap holds the nginx configuration.
- The ConfigMap with the wrapper script is no longer rendered.
  It carries the label `app.kubernetes.io/name: mailu-nginx-patch`.
- The Ingress path `/health` is no longer rendered.
- Without `resources.front` the front requests 10m CPU and 16Mi memory, with limits of 100m and 64Mi.
  Before, it got the cdk8s-plus defaults with limits of 1.5 CPU and 2Gi.
- The front does no reverse DNS lookups.
  Postfix logs submissions as `client=unknown[<address>]`.
- The front carries about 1000 concurrent mail sessions.
  It runs two worker processes with 1024 connections each, and a relayed session takes two connections.
  The Mailu image started one worker per CPU core.

The names of the front Deployment and Service stay the same.
The Traefik routes stay the same.

If you upgrade from 0.3, port 587 goes away in the same step.
See {ref}`Migrate existing deployments from port 587 <migrate-from-port-587>`.

(upgrade-front-before)=

## Before you deploy

1. If you pull images through a registry mirror, set `images.front` to the mirrored nginx image.
   `images.registry` and `images.tag` no longer apply to the front.
2. If network policies name the ports of the front pod, change them to 10465, 10993, and 10995.
   A NetworkPolicy matches the container port.
   The Service port does not count.
   The same applies to Services of your own that target the front pods by port number.
3. If a log parser reads the failed logins of the front, check its pattern against the new line.
   The text is the same as before.
   The `server:` field now shows the container port, for example `0.0.0.0:10993`.
4. If you set `resources.front`, review the values.
   The proxy needs a few megabytes of memory.
5. If you disabled the admin component, disable the front as well.
   A chart with the front but without admin is rejected.
6. Check that the cluster can pull the image set in `images.front`.
   The next section explains why this matters.

(upgrade-front-deploy)=

## Deploy

The Service switches to the new target ports the moment you apply the manifests.
The old pod does not listen on them.
Until the new pod is ready, new connections to 465, 993, and 995 are refused.
The rolling update does not close this gap.
It lasts as long as the new pod needs to pull its image and to start.
If the new pod cannot start, the mail ports stay down until you roll back.

1. Deploy the new manifests.
2. Watch the rollout until the new pod is ready:

   ```shell
   kubectl rollout status -n mailu deployment -l app.kubernetes.io/name=mailu-front
   ```

Open mail sessions end when the old pod stops.
Mail clients reconnect on their own.

(upgrade-front-after)=

## After you deploy

1. Log in with a mail client over IMAP and send a message.
2. If you use `ingress.traefik.proxyProtocolToFront`, try one login with a wrong password.
   Then read the log of the front:

   ```shell
   kubectl logs -n mailu -l app.kubernetes.io/name=mailu-front | grep 'login failed'
   ```

   The line names your public address after `client:`.
   An address of Traefik there means that nginx ignored the PROXY header.
   nginx trusts the header only from senders inside `subnet`.
   Set `subnet` to a network that contains the addresses Traefik connects from.
3. Delete the ConfigMap with the wrapper script when your deployment tool does not prune:

   ```shell
   kubectl delete configmap -n mailu -l app.kubernetes.io/name=mailu-nginx-patch
   ```

(upgrade-front-roll-back)=

## Roll back

Deploy the manifests of the previous version of cdk8s-mailu.
The Mailu front image and the wrapper script come back with them.
The Service switches its target ports back at once.
New connections are refused again until the old front is ready.
