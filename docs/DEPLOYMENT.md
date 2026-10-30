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
| `RADAR_RAW_RETENTION_DAYS` | Opcional: dias de respostas brutas da fonte guardados, de 7 a 3650; padrão 30 ([retenção](#logs-e-retenção)) |

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
curl -sS https://radar.example.com/api/health
```

Substitua o domínio pelo configurado. Sem sessão de administrador, a resposta é só `{"ok": true}` com HTTP 200, ou `{"ok": false}` com HTTP 503. O corpo completo vai para o loopback do container, que o `HEALTHCHECK` da imagem usa, e para sessão de administrador, como no painel **Administração**. Para lê-lo no servidor:

```sh
docker compose --env-file deploy/cloud.env -f compose.cloud.yaml exec app \
  python -c "import urllib.request as r; print(r.urlopen('http://127.0.0.1:8765/api/health').read().decode())"
```

Com `ok: false`, o comando termina com `HTTP Error 503`. `ok` exige:

- `db_ok`: leitura do banco com timeout de 2 segundos;
- `collector_alive`, `email_sender_alive` e `whatsapp_sender_alive`;
- `heartbeats`: segundos desde a última volta de cada trabalhador, até 120 para o coletor e 300 para os envios.

`alert_links_local` não altera `ok`: com `true`, os links de alerta apontam para o loopback (127.0.0.1, localhost ou ::1) e só abrem no próprio servidor. Defina `RADAR_PUBLIC_URL`.

O `index.html` da interface tem um script inline que aplica a aparência escolhida (Sistema, Claro ou Escuro) antes da primeira pintura. Uma CSP com `script-src` na interface precisa liberar esse script por hash ou nonce.

`source` mostra o estado da fonte de tarifas (`ok`, `degraded` ou `paused`) e não altera `ok`: reiniciar o container não desfaz um bloqueio da fonte. O `HEALTHCHECK` da imagem consulta `ok`, `collector_alive` e `whatsapp_sender_alive`.

Depois valide login, criação de monitoramento, coleta e recebimento de um alerta. O endpoint de saúde não comprova entrega de mensagens.

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

## Encerramento da aplicação

`stop app`, `restart app` e o `up` que recria um container em execução enviam SIGTERM à aplicação e, se ela não terminar em 45 s (`stop_grace_period`), SIGKILL. A aplicação para de aceitar conexões, espera até 10 s as requisições em curso e depois até 30 s o coletor e os remetentes:

- Coleta: nenhum ciclo ou consulta começa. Consultas já enviadas têm até 25 s dessa espera para responder; as que não responderem são encerradas. Consultas encerradas ou não iniciadas não registram falha nem contam no disjuntor ou no recuo: a rota mantém o último resultado e o ciclo fica `interrupted`. Ao reiniciar, o próximo ciclo de cada busca ativa fica no mais tarde entre agora, cinco minutos após o último início e o horário agendado.
- Envios: e-mail e WhatsApp não pegam itens novos da fila, e o envio em curso termina. Se passar do prazo, o item fica `sending` e vira `uncertain` ao reiniciar, sem reenvio automático.

As esperas somam até 40 s. Não reduza o `stop_grace_period` de `compose.cloud.yaml` e `compose.yaml` nem passe a esses comandos `--timeout` abaixo de 45: com SIGKILL antes do fim, consultas em andamento se perdem sem registrar falha, e o reinício marca o ciclo como `interrupted` e os envios em curso como `uncertain`.

Para conferir, leia os logs depois de `stop app` e antes do `up`: ao recriar o container, o `up` descarta os logs do anterior.

```sh
docker compose --env-file deploy/cloud.env -f compose.cloud.yaml stop app &&
docker compose --env-file deploy/cloud.env -f compose.cloud.yaml logs --tail=100 app
```

Mensagens do encerramento:

- `Consulta à fonte interrompida` (`INFO`, com `search_id`): consulta pulada, sem falha.
- `Consultas em andamento encerradas` (`INFO`): `queries` conta as consultas encerradas aos 25 s.
- `Prazo de encerramento esgotado` (`WARNING`): `workers` lista os trabalhadores ainda ativos aos 30 s, entre `collector`, `email_sender` e `whatsapp_sender`.
- `Shutting down` e `Application shutdown complete.` (logger `uvicorn.error`): início e fim do encerramento; sem a segunda, o processo terminou antes do fim das esperas, como por SIGKILL.

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

O Compose limita logs do container a três arquivos de 10 MB. A aplicação escreve um objeto JSON por linha, com `time`, `level`, `logger`, `message` e, quando houver, campos como `search_id`, `cycle_id`, `outbox_id`, `kind`, `queries` e `workers`. O nível vem de `RADAR_LOG_LEVEL`; os arquivos Compose não definem a variável e o padrão é `INFO`. Os logs não incluem senhas, tokens, telefones, e-mails ou corpo de mensagens.

Registros de envio e auditoria têm retenção própria, ajustável em **Administração → Retenção**, com limpeza manual e prévia. Na auditoria, login recusado, tentativas limitadas, recuperação solicitada, login com sucesso, saída, senha aceita na verificação em duas etapas e código recusado nela repetidos com o mesmo IP e conta (na recuperação, também o mesmo canal) em até 10 minutos são agregados em um registro com `count` e `last_seen`; login com sucesso e saída só se agregam com o mesmo navegador e sistema (`user_agent`), para que outro dispositivo no mesmo IP apareça em registro próprio. A limpeza horária aplica a retenção em dias pela última ocorrência e cotas separadas, em que uma categoria não remove registros de outra: 5 mil para login recusado, tentativas limitadas e recuperação solicitada; 20 mil para os demais eventos de conta (login, saída, verificação em duas etapas, cadastro e redefinição de senha); e 20 mil para administração e configuração (eventos `admin_*`, entre eles ativar e desativar a verificação em duas etapas, e criação do primeiro administrador). Alterar a retenção e limpar logs manualmente geram registros de auditoria. Um estado `unhealthy` não reinicia automaticamente o container.

Respostas brutas da fonte (tabela `results`) ficam `RADAR_RAW_RETENTION_DAYS` dias (padrão 30, de 7 a 3650); a última tentativa e a última resposta válida de cada rota e versão dos filtros, e as respostas reaproveitadas por uma versão mais nova dos filtros, ficam sempre. Respostas novas são gravadas compactadas (zlib); versões até a 0.32.0 não as leem, e voltar a uma delas exige restaurar o backup feito antes da atualização. A limpeza horária remove até 10 mil respostas vencidas e compacta até 5 mil gravadas em texto por versões anteriores, das mais novas para as mais antigas, em transações de até 500 linhas; quando faz algo, registra `Retenção de respostas brutas aplicada` com `results`, `cycles` e `compressed`. O espaço liberado é reaproveitado pelo banco, mas o arquivo só diminui com a [compactação](#compactação-do-banco).

Valor em uso, depois de alterar `deploy/cloud.env` e recriar o container com `up -d --wait`:

```sh
docker compose --env-file deploy/cloud.env -f compose.cloud.yaml exec app \
  python -c "from backend.retention import days; print(days())"
```

O que falta para a limpeza horária, com o banco aberto só para leitura:

```sh
docker compose --env-file deploy/cloud.env -f compose.cloud.yaml exec app \
  python -c "from backend.retention import progress; print(progress())"
```

`expired` conta respostas vencidas ainda não removidas e `text` as gravadas sem compactação; `cursor` é o próximo ponto da compactação, `None` antes da primeira limpeza. A limpeza terminou com `{'expired': 0, 'text': 0, 'cursor': 0}`. A contagem de `expired` lê a tabela inteira.

Mantenha uma única instância por volume SQLite. O Compose local usa um volume distinto; dados locais não migram automaticamente para a nuvem.

## Compactação do banco

`scripts/compact.py` executa `PRAGMA wal_checkpoint(TRUNCATE)` e `VACUUM` em `radar.sqlite3` e imprime o tamanho antes e depois. Rode depois que a limpeza horária terminar (veja `progress()` em [Logs e retenção](#logs-e-retenção)), com a aplicação parada. O script recusa sem alterar nada com `Banco em uso` se outra conexão estiver com o banco aberto, ou com `Espaço livre insuficiente` se o volume de dados não tiver cerca de duas vezes o tamanho dos dados do banco: a cópia temporária do `VACUUM` e o WAL ficam no volume de dados, não em `/tmp`. Durante a execução, mantém o banco bloqueado. Com a aplicação ociosa, sem conexão aberta, ele não a detecta.

1. Pare a aplicação e confirme que o serviço `app` não aparece em execução:

   ```sh
   docker compose --env-file deploy/cloud.env -f compose.cloud.yaml stop app
   docker compose --env-file deploy/cloud.env -f compose.cloud.yaml ps
   ```

2. Compacte:

   ```sh
   docker compose --env-file deploy/cloud.env -f compose.cloud.yaml run --rm app python scripts/compact.py
   ```

3. Inicie a aplicação, mesmo se a compactação falhar:

   ```sh
   docker compose --env-file deploy/cloud.env -f compose.cloud.yaml up -d --wait
   ```
