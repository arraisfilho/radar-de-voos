# Instalação com Docker e implantação na nuvem

O projeto fornece apenas a aplicação. Seu proxy reverso já existente cuida do domínio e de HTTPS; nenhum Nginx, Caddy ou certificado é instalado por estes arquivos. A implantação pública é um piloto com uma instância, SQLite persistente, cadastro de clientes pelo administrador e coleta em segundo plano.

## O que precisa

- Servidor Linux com Docker Engine e plugin Docker Compose. Como ponto de partida para o piloto, reserve 2 vCPU, 4 GB RAM e disco persistente; o consumo depende de usuários, rotas e retenção.
- Git, acesso SSH ao servidor e acesso de leitura ao repositório privado, quando for enviado ao GitHub. Também é possível transferir uma cópia dos fontes.
- Domínio HTTPS e proxy já configurados por você. Libere na infraestrutura somente as entradas necessárias ao proxy e ao SSH.
- Saída de rede para buscar tarifas e acessar o provedor de alertas. Algumas nuvens restringem SMTP; confirme a porta com seu provedor.

No Ubuntu, siga a [instalação oficial do Docker Engine](https://docs.docker.com/engine/install/ubuntu/), que inclui o plugin Compose. Confira:

```sh
docker version
docker compose version
```

Use `sudo docker` se o usuário do servidor ainda não tiver acesso ao daemon. Acesso ao Docker equivale a administração do servidor. Não há instalação de Docker, proxy ou modificação de firewall escondida nos scripts do radar.

## 1. Obter os fontes

Depois de criar o repositório privado e enviar o código, no servidor:

```sh
git clone URL_DO_SEU_REPOSITORIO_PRIVADO radar-app
cd radar-app
```

Troque o marcador pela URL do seu repositório. Nenhum remoto é criado nem recebe código por esses documentos. Configure a autenticação Git/SSH fora dos arquivos do projeto.

## 2. Preparar o ambiente público

```sh
cp deploy/cloud.env.example deploy/cloud.env
chmod 600 deploy/cloud.env
```

Edite `deploy/cloud.env`:

```dotenv
RADAR_DOMAIN=radar.seudominio.com
RADAR_UPSTREAM_PORT=8765
RADAR_PUBLISHED_HOST=127.0.0.1
RADAR_TRUSTED_PROXY=172.30.88.1
```

O exemplo usa proxy no mesmo servidor e publica somente `127.0.0.1:8765`. Se seu proxy estiver em outra máquina ou container, escolha uma interface privada alcançável por ele e configure `RADAR_TRUSTED_PROXY` com o IP exato do par TCP visto pela aplicação. O IP final do usuário não é o proxy confiável. Não use `*` ou uma rede inteira. Restrinja a porta ao proxy por rede/firewall; publicá-la em `0.0.0.0` não cria essa restrição automaticamente.

A rede Docker deste arquivo é `172.30.88.0/24`, gateway `172.30.88.1`. Se ela conflitar com sua infraestrutura, ajuste subnet, IP da aplicação e gateway confiável juntos. O Compose local usa outra rede, `172.30.87.0/24`.

Valide e construa:

```sh
docker compose --env-file deploy/cloud.env -f compose.cloud.yaml config --quiet
docker compose --env-file deploy/cloud.env -f compose.cloud.yaml build
```

A imagem compila o frontend, instala as dependências Python travadas e executa como usuário sem privilégios. Senhas, tokens, banco local e identidade OAuth desta instalação ficam fora do contexto da imagem.

## 3. Criar o primeiro administrador

Antes de iniciar a aplicação pela primeira vez:

```sh
docker compose --env-file deploy/cloud.env -f compose.cloud.yaml run --rm app python scripts/create_admin.py
```

Informe nome, país ISO (`BR`, `US`, `PT`...), telefone e senha no terminal. A senha é solicitada sem eco, não vai em argumentos ou variáveis do shell. O comando não substitui um administrador existente. Não execute esse assistente contra uma instância em uso; ele é um comando de instalação inicial.

Na nuvem, o cadastro público e o bootstrap via navegador ficam fechados. Entre como administrador e cadastre os clientes em **Administração → Cadastros**. O limite inicial é de cinco buscas por conta; o administrador pode ajustá-lo.

## 4. Iniciar a aplicação

```sh
docker compose --env-file deploy/cloud.env -f compose.cloud.yaml up -d --wait
docker compose --env-file deploy/cloud.env -f compose.cloud.yaml ps
```

A porta publicada será a escolhida em `RADAR_UPSTREAM_PORT`, encaminhada à porta `8765` do container. O volume `radar-cloud_radar_data` contém o SQLite e as credenciais privadas. O container reinicia com o Docker, mas um estado `unhealthy` sozinho não provoca reinício automático: acompanhe a saúde do serviço.

O endpoint `/api/health` é verificado dentro do container. Pode ser consultado também pelo domínio HTTPS. Uma chamada HTTP direta à porta de produção, sem o proxy, pode retornar 403: a aplicação exige HTTPS e o domínio configurado.

## 5. Encaminhar no seu proxy existente

Configure no proxy, a seu critério:

- Origem externa: `https://radar.seudominio.com`.
- Destino interno: interface/porta publicadas no passo 2, por exemplo `http://127.0.0.1:8765`.
- Preserve o `Host` do domínio público.
- Sobrescreva `X-Forwarded-Proto` com `https` depois de terminar TLS.
- Sobrescreva `X-Forwarded-For` com o IP real do cliente; não copie cegamente valores recebidos da Internet.
- Limite o corpo das requisições a aproximadamente 50 KB e não faça cache das rotas `/api/`.

A aplicação só aceita cabeçalhos de proxy enviados pelo IP exato configurado. Com isso, cookies usam `Secure` e a auditoria pode registrar o cliente real. O fornecimento de certificado, renovação e configuração do proxy permanecem na sua infraestrutura. Se mudar o domínio ou a porta externa HTTPS, ajuste também a origem canônica; este Compose espera HTTPS na porta externa 443.

Abra o domínio e teste login, logout, criação de uma busca, reconexão e recebimento de um alerta para um destinatário seu. O deploy deve ser validado no servidor antes de convidar usuários. Não basta a imagem compilar para comprovar que a fonte de tarifas aceita o IP da nuvem.

## 6. Configurar alertas

**SMTP:** configure no painel administrativo. Os clientes informam somente os próprios destinatários. Para Gmail/Workspace, a senha normal da conta pode não ser aceita; use uma forma de autenticação suportada pela conta ou um serviço SMTP apropriado.

**WhatsApp:** configure provedor, URL, sessão e token em **Administração → Canais → WhatsApp**. Confirme a conectividade do servidor com seu integrador e faça um teste explícito para um número seu. Nada é enviado durante o build.

**Google OAuth:** o assistente atual é local, com cliente Desktop/retorno loopback. Não é um fluxo OAuth web pronto para conectar remotamente no domínio da nuvem. Para o primeiro deploy, use SMTP. A identidade pública e os tokens desta máquina não acompanham Git nem imagem. Um OAuth web hospedado com consentimento/callback HTTPS é uma evolução separada; não simule isso liberando o bootstrap público ou expondo segredos. Consulte `GOOGLE_MAIL.md`.

**Telegram:** ainda não é um transporte funcional. Não é habilitado pelo container.

## 7. Logs, backup e restauração

Logs de containers são rotacionados em três arquivos de 10 MB. Histórico de envios e dados de coleta têm suas próprias políticas no painel/documentação; rotação de stdout não apaga o histórico do banco.

```sh
docker compose --env-file deploy/cloud.env -f compose.cloud.yaml logs --tail=100 app
```

Antes de atualizar, pare somente o radar para manter banco e arquivos de credenciais sincronizados e gere o backup:

```sh
docker compose --env-file deploy/cloud.env -f compose.cloud.yaml stop app
docker compose --env-file deploy/cloud.env -f compose.cloud.yaml run --rm app python scripts/backup.py
```

O comando imprime `/data/backups/radar-DATA.tar.gz`. Contém um snapshot SQLite validado e os JSON privados, sem duplicar cache de logos. Copie o arquivo para fora do servidor por um canal seguro; ele contém dados pessoais e credenciais. Exemplo, substituindo `NOME_DO_BACKUP.tar.gz` pelo nome impresso:

```sh
mkdir -p backups
chmod 700 backups
docker compose --env-file deploy/cloud.env -f compose.cloud.yaml cp app:/data/backups/NOME_DO_BACKUP.tar.gz backups/
chmod 600 backups/NOME_DO_BACKUP.tar.gz
```

`compose cp` funciona com o container parado. Faça backup periódico, monitore o espaço e retenha apenas as cópias necessárias; a pasta de backups não é limpa automaticamente.

Para restaurar uma cópia confiável, pare o radar, guarde uma cópia do estado atual e execute:

```sh
docker compose --env-file deploy/cloud.env -f compose.cloud.yaml stop app
docker compose --env-file deploy/cloud.env -f compose.cloud.yaml run --rm -T app python scripts/restore.py --from-stdin < backups/NOME_DO_BACKUP.tar.gz
docker compose --env-file deploy/cloud.env -f compose.cloud.yaml up -d --wait
```

O comando verifica o arquivo e a integridade do banco antes de substituir dados; recusa caminhos inesperados e links. As credenciais JSON são substituídas pelo conjunto completo do backup, incluindo a remoção de credenciais posteriores ausentes daquela cópia. Restauração substitui o estado atual: mantenha backup anterior e teste a recuperação antes de depender dela.

Não use `docker compose down -v`: `-v` apaga o volume. `docker compose down`, sem `-v`, preserva os dados.

## 8. Atualizar

Com backup externo concluído:

```sh
git pull --ff-only
docker compose --env-file deploy/cloud.env -f compose.cloud.yaml up -d --build --wait
docker compose --env-file deploy/cloud.env -f compose.cloud.yaml ps
```

Confira saúde, login e logs. Se falhar, preserve o backup e volte à revisão anterior junto do banco compatível. Migrações SQLite não têm downgrade automático. Não mantenha duas versões coletando/enviando sobre o mesmo volume.

## Docker local, sem publicar na Internet

```sh
docker compose build
docker compose run --rm app python scripts/create_admin.py
docker compose up -d --wait
```

Acesse `http://127.0.0.1:8765`. Se o servidor Python já estiver usando a porta, prefixe **todos** os comandos com `RADAR_LOCAL_PORT=18765` e acesse a porta 18765. O volume local `radar_radar_data` é separado do modo nuvem e dos dados atuais fora do repositório. Nada é migrado automaticamente desta máquina para um servidor novo.

## Limites desta entrega

Uma aplicação/worker e um volume SQLite, sem múltiplas réplicas. Ainda não há HA, banco gerenciado, e-mail/telefone verificado por código nem integração de pagamento. Google Flights via `fast-flights` não oferece SLA; cobertura, limites e disponibilidade da fonte continuam externos ao radar. Para escalar, separar coleta/fila, banco e workers vem antes de multiplicar containers.

Referências: [Docker Engine](https://docs.docker.com/engine/install/ubuntu/), [Docker Compose](https://docs.docker.com/compose/install/linux/). Os arquivos não dependem de marca específica de nuvem ou de proxy.
