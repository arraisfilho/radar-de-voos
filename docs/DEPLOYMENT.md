# Implantação e operação

## Requisitos

- Servidor Linux com Docker Engine, Docker Compose e Git.
- Domínio com HTTPS e proxy reverso existente.
- Disco persistente e conectividade com a fonte de tarifas e os provedores de alertas.

Configuração inicial sugerida: 2 vCPU e 4 GB de RAM. Dimensione disco e capacidade conforme a carga. Instalação do Docker: [guia oficial para Ubuntu](https://docs.docker.com/engine/install/ubuntu/).

## Instalação

```sh
git clone https://github.com/arraisfilho/radar-de-voos.git
cd radar-de-voos
cp deploy/cloud.env.example deploy/cloud.env
chmod 600 deploy/cloud.env
```

Edite `deploy/cloud.env`:

| Variável | Finalidade |
|---|---|
| `RADAR_DOMAIN` | Domínio público, sem protocolo ou caminho |
| `RADAR_UPSTREAM_PORT` | Porta da aplicação acessada pelo proxy |
| `RADAR_PUBLISHED_HOST` | Interface de publicação; padrão restrito ao próprio servidor |
| `RADAR_TRUSTED_PROXY` | IP exato do proxy visto pela aplicação |

Para proxy instalado no mesmo servidor, mantenha os valores de rede do exemplo. Se a rede Docker conflitar com outra rede existente, ajuste subnet, endereço da aplicação e proxy confiável em conjunto. Proxies remotos exigem uma interface privada acessível e restrição da porta na infraestrutura.

Valide e construa:

```sh
docker compose --env-file deploy/cloud.env -f compose.cloud.yaml config --quiet &&
docker compose --env-file deploy/cloud.env -f compose.cloud.yaml build
```

Crie o primeiro administrador **antes de iniciar o serviço**:

```sh
docker compose --env-file deploy/cloud.env -f compose.cloud.yaml run --rm app python scripts/create_admin.py
```

O assistente solicita nome, país, telefone, e-mail e senha. Não há senha padrão. Se já houver administrador, nenhuma conta será alterada. Se a aplicação estiver em execução, pare o serviço `app` antes deste comando: o container temporário utiliza o mesmo IP fixo.

```sh
docker compose --env-file deploy/cloud.env -f compose.cloud.yaml up -d --wait
```

## Proxy reverso

O projeto não instala proxy nem certificados. Configure no proxy existente:

- Encaminhamento para a interface publicada e a porta `RADAR_UPSTREAM_PORT`.
- `Host` preservado com o domínio público.
- `X-Forwarded-Proto` definido como `https` após terminar TLS.
- `X-Forwarded-For` definido com o IP do cliente, sobrescrevendo valores externos não confiáveis.
- Sem cache de `/api/` e limite de corpo de aproximadamente 50 KB.

Confie somente no IP exato do par TCP definido em `RADAR_TRUSTED_PROXY`. Em produção, a aplicação exige HTTPS e o domínio configurado; acesso HTTP direto pode retornar 403.

## Verificação inicial

```sh
curl -fsS https://radar.example.com/api/health
```

Substitua o domínio pelo configurado. Confira versão e trabalhadores ativos. Depois valide login, criação de monitoramento, coleta e recebimento de um alerta. O endpoint de saúde não comprova acesso à fonte de tarifas nem entrega de mensagens.

Configure os remetentes em **Administração → Canais**: [Google OAuth](GOOGLE_MAIL.md), SMTP ou [WhatsApp](WHATSAPP.md). Clientes cadastram os destinatários no próprio perfil. Telegram está indisponível.

## Atualização

Execute na pasta clonada do repositório. O procedimento interrompe brevemente o serviço para gerar um backup consistente:

```sh
docker compose --env-file deploy/cloud.env -f compose.cloud.yaml stop app &&
docker compose --env-file deploy/cloud.env -f compose.cloud.yaml run --rm app python scripts/backup.py
```

Após confirmar o backup e copiá-lo para armazenamento externo:

```sh
git pull --ff-only &&
docker compose --env-file deploy/cloud.env -f compose.cloud.yaml up -d --build --wait
```

Confira `/api/health`, login e logs. Se o backup ou o Git falhar, corrija o erro antes de prosseguir. Para recolocar a versão existente em execução, use `up -d --wait`.

Se `git pull` informar que a pasta não é um repositório, use uma cópia obtida com `git clone`; diretórios extraídos de ZIP não possuem metadados Git. Preserve `deploy/cloud.env` e o volume da instalação ao substituir os fontes.

## Backup e restauração

O volume `radar-cloud_radar_data` guarda banco e credenciais. O backup acima gera um arquivo em `/data/backups/` e imprime o nome. Copie-o para o host, substituindo `NOME_DO_BACKUP.tar.gz`:

```sh
mkdir -p backups && chmod 700 backups
docker compose --env-file deploy/cloud.env -f compose.cloud.yaml cp app:/data/backups/NOME_DO_BACKUP.tar.gz backups/
chmod 600 backups/NOME_DO_BACKUP.tar.gz
```

Mantenha uma cópia externa protegida: o arquivo contém dados pessoais e segredos. Backups não são removidos automaticamente. `deploy/cloud.env` deve ser preservado separadamente.

Para restaurar, guarde antes uma cópia do estado atual:

```sh
docker compose --env-file deploy/cloud.env -f compose.cloud.yaml stop app &&
docker compose --env-file deploy/cloud.env -f compose.cloud.yaml run --rm -T app python scripts/restore.py --from-stdin < backups/NOME_DO_BACKUP.tar.gz &&
docker compose --env-file deploy/cloud.env -f compose.cloud.yaml up -d --wait
```

A restauração valida o arquivo e substitui banco e credenciais privadas. Não há downgrade automático de migrações. **Não execute `docker compose down -v`: isso apaga o volume.**

## Logs e retenção

```sh
docker compose --env-file deploy/cloud.env -f compose.cloud.yaml logs --tail=100 app
```

O Compose limita logs do container a três arquivos de 10 MB. Registros de envio e auditoria têm retenção própria, ajustável em **Administração → Retenção**, com limpeza manual e prévia. Um estado `unhealthy` não reinicia automaticamente o container.

Mantenha uma única instância por volume SQLite. O Compose local usa um volume distinto; dados locais não migram automaticamente para a nuvem.
