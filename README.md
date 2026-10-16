# Radar de Voos

Aplicação web para monitorar tarifas aéreas e receber alertas de preço por e-mail e WhatsApp. Interface responsiva em português, inglês e espanhol.

## Funcionalidades

- Monitoramentos de ida ou ida e volta, com múltiplos aeroportos, janelas de data/horário, passageiros e moeda.
- Filtros de escalas, duração, companhias, chegada, conexões e taxas estimadas de bagagem.
- Atualização periódica, metas de preço, histórico de variações e gráficos por trecho.
- Contas individuais, contatos internacionais e limite de monitoramentos ajustável pelo administrador.
- Administração de usuários, canais, envios, auditoria e retenção de registros.
- E-mail por Gmail API/OAuth ou SMTP; WhatsApp por OpenWA, com suporte a novos adaptadores.

## Instalação

O método recomendado é Docker Compose. O projeto fornece a aplicação; domínio, HTTPS e proxy reverso são responsabilidade da infraestrutura.

```sh
git clone https://github.com/arraisfilho/radar-de-voos.git
cd radar-de-voos
```

Siga o [guia de implantação](docs/DEPLOYMENT.md) para configurar o ambiente, criar o administrador e iniciar o serviço. Para executar sem containers, consulte [desenvolvimento local](docs/DEVELOPMENT.md).

## Documentação

| Guia | Conteúdo |
|---|---|
| [Implantação e operação](docs/DEPLOYMENT.md) | Docker, proxy, atualização, backup e restauração |
| [Contas e contatos](docs/ACCOUNTS.md) | Login, usuários, limites e recuperação de senha |
| [E-mail Google](docs/GOOGLE_MAIL.md) | OAuth Web em produção e cliente Desktop local |
| [WhatsApp](docs/WHATSAPP.md) | Configuração OpenWA e contrato de integradores |
| [Regras do produto](docs/PRODUCT_SPEC.md) | Monitoramentos, filtros, preços e alertas |
| [Arquitetura](docs/ARCHITECTURE.md) | Componentes, persistência e processamento |
| [Segurança](docs/SECURITY_REVIEW.md) | Proteções e limites operacionais |
| [Desenvolvimento](docs/DEVELOPMENT.md) | Ambiente local, configuração e testes |
| [Validação](docs/VALIDATION.md) | Cobertura automatizada e testes operacionais |
| [Alterações](CHANGELOG.md) | Mudanças recentes |

## Tecnologia e limites

React, TypeScript e Vite no frontend; Python/FastAPI, SQLite e trabalhadores de coleta/envio no backend. A fonte de tarifas utiliza `fast-flights`.

O projeto está em estágio de piloto, com uma instância de aplicação e volume persistente. A coleta tem cadência de cinco minutos, sujeita à fila e à disponibilidade da fonte. Tarifas observadas não garantem disponibilidade de compra; franquias e condições devem ser confirmadas no vendedor. Telegram ainda não possui transporte implementado.

Dados, credenciais e backups ficam fora do Git. Consulte os guias antes de publicar uma instalação.
