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

The names of the front Deployment and Service stay the same.
The Traefik routes stay the same.

(upgrade-front-before)=

## Before you deploy

1. If you pull images through a registry mirror, set `images.front` to the mirrored nginx image.
   `images.registry` and `images.tag` no longer apply to the front.
2. If network policies name the ports of the front pod, change them to 10465, 10993, and 10995.
   A NetworkPolicy matches the container port.
   The Service port does not count.
3. If a log parser reads the failed logins of the front, check its pattern against the new line.
   The text is the same as before.
   The `server:` field now shows the container port, for example `0.0.0.0:10993`.
4. If you set `resources.front`, review the values.
   The proxy needs a few megabytes of memory.
5. If you disabled the admin component, disable the front as well.
   A chart with the front but without admin is rejected.

(upgrade-front-deploy)=

## Deploy

Deploy the new manifests.
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
   An address of the pod network there means that Traefik and the front disagree about the PROXY protocol.
3. Delete the ConfigMap with the wrapper script when your deployment tool does not prune:

   ```shell
   kubectl delete configmap -n mailu -l app.kubernetes.io/name=mailu-nginx-patch
   ```

(upgrade-front-roll-back)=

## Roll back

Deploy the manifests of the previous version of cdk8s-mailu.
The Mailu front image and the wrapper script come back with them.
