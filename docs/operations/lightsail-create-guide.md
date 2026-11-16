# AWS Lightsail — create the NoMarkup origin (Founder)

**Decision (locked when we resume):** capital-light day-one host = **AWS Lightsail** (US), Docker Compose + Caddy, Cloudflare Free in front.

> **Paused:** Do not create the instance until development/testing is ready.
> Day-to-day work uses **local** `bin/dev` + Stripe **test**. When ready, follow
> this guide, then reply with `Lightsail IP: x.x.x.x`.

**Console:** [https://lightsail.aws.amazon.com](https://lightsail.aws.amazon.com)

You need an AWS account (same login as other AWS products). Lightsail is the simple UI; later you can graduate toward full AWS/EKS using `deploy/terraform` + `deploy/k8s`.

---

## 1. Create instance (exact choices)

1. Open [Lightsail home](https://lightsail.aws.amazon.com/ls/webapp/home/instances).
2. **Create instance**.
3. **Instance location**
   - Prefer **Oregon (`us-west-2`)** or **N. California (`us-west-1`)** for King County / West Coast users.
4. **Pick your instance image**
   - Platform: **Linux/Unix**
   - Blueprint: **OS Only** → **Ubuntu 24.04 LTS** (or newest Ubuntu LTS shown).
   - Do **not** pick WordPress / Node prebuilds — we install Docker ourselves.
5. **Optional: enable Automatic Snapshots** (recommended when cash allows; ~small extra).
6. **Choose instance plan** (RAM is the constraint for Compose):

   | Plan (indicative) | RAM | When |
   |-------------------|-----|------|
   | **$10/mo** class | **2 GB** | Absolute minimum; lean services only; may OOM under build |
   | **$20/mo** class | **4 GB** | **Recommended** for lean prod (pg + redis + meili + go + web) |
   | **$40/mo** class | **8 GB** | Safer builds + optional engines later |

   Prefer **4 GB** if you can. Builds of Go/Next on 2 GB are painful.

7. **Identify your instance**
   - Name: `nomarkup-prod` (or `nomarkup-staging` if you want a first non-prod box).
8. **SSH key**
   - Use **custom key** = your Mac public key, or download Lightsail’s default key and keep it safe.
9. **Create instance**.

---

## 2. Networking (required)

On the instance → **Networking**:

1. **Static IP**
   - Create **Static IP** → attach to `nomarkup-prod`.
   - Copy this IPv4 — this is what Cloudflare DNS will use.
2. **Firewall (IPv4)** — allow:

   | App | Protocol | Port |
   |-----|----------|------|
   | SSH | TCP | 22 |
   | HTTP | TCP | 80 |
   | HTTPS | TCP | 443 |

   (Default often already has 22 + 80; **add 443** if missing.)

Optional later: restrict SSH to your home IP.

---

## 3. After create — send the agent

Reply in chat with:

```text
Lightsail IP: x.x.x.x
Region: us-west-2
SSH user: ubuntu
```

(Ubuntu blueprints use user **`ubuntu`**. Amazon Linux would be `ec2-user` — we chose Ubuntu.)

Then the agent can drive:

1. Cloudflare A records (`@`, `www`, `api` → static IP, proxied)
2. `scripts/prod/bootstrap-vps.sh` over SSH
3. `deploy/prod` Compose deploy
4. Smoke + Stripe webhook URL update

---

## 4. Cost envelope

| Item | Typical |
|------|---------|
| Lightsail 4 GB | ~$20/mo |
| Static IP | free while attached |
| Snapshots | small extra |
| Cloudflare Free | $0 |
| Stripe | % of charges only |

Still far cheaper than EKS day one; path into full AWS remains open.

---

## 5. SSH from your Mac (after create)

```bash
# if you downloaded lightsail-default key:
chmod 400 ~/Downloads/LightsailDefaultKey-*.pem
ssh -i ~/Downloads/LightsailDefaultKey-us-west-2.pem ubuntu@YOUR_STATIC_IP

# or your own key:
ssh ubuntu@YOUR_STATIC_IP
```

Then (on server, after git clone of NoMarkup):

```bash
sudo bash scripts/prod/bootstrap-vps.sh
# copy deploy/prod/.env.example → deploy/prod/.env and fill secrets
bash scripts/prod/deploy.sh
```

Full ordered path: [`capital-light-production.md`](./capital-light-production.md).
