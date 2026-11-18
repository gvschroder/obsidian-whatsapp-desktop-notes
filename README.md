# WhatsApp Desktop (macOS)

🇬🇧 **[Read in English](README.en.md)**

> [!IMPORTANT]
> **Somente macOS.** Requer o app oficial do WhatsApp Desktop para Mac. Windows e
> Linux não são suportados: neles o plugin fica inativo. Veja
> [Por que só macOS](#por-que-só-macos).

Transforme suas conversas do WhatsApp Desktop em notas no seu vault do Obsidian —
uma pasta por conversa com uma nota por mês (ou por ano, semana, dia, ou uma
nota só), atualizadas automaticamente. Tudo acontece no seu Mac: o
plugin lê o banco de dados local do WhatsApp Desktop, somente leitura, e nunca
acessa a internet.

---

## O que você ganha

```
WhatsApp/
├── WhatsApp Index.md      ← índice das conversas sincronizadas, mais recentes primeiro
├── Pessoais/
│   └── Alice Souza/
│       ├── 2026-02.md
│       └── 2026-03.md
└── Grupos/
    └── Projeto Falcon/
        └── 2026-03.md
```

Cada nota começa com propriedades — incluindo quem está na conversa e o
período — e cresce a cada sincronização, com uma seção por dia:

```markdown
---
source: whatsapp-desktop
whatsapp_jid: "5511999990001@s.whatsapp.net"
whatsapp_chat: "Alice Souza"
whatsapp_period: "2026-03"
whatsapp_period_type: month
whatsapp_period_start: 2026-03-01
whatsapp_period_end: 2026-03-31
chat_type: personal
participants:
  - "Alice Souza"
  - "Eu"
---

# Alice Souza · março de 2026

## 2026-03-10

**09:14** — Alice Souza: Viu a proposta?

**09:15** — Alice Souza: [Documento: proposta-v2.pdf]

**09:20** — Eu: [Áudio 0:42]
```

- **Escolha o que sincronizar:** todas as conversas, só grupos, só conversas
  pessoais, só as que você escolher ou todas exceto as escolhidas.
- **Escolha até quando voltar:** últimos 7, 30, 90 ou 365 dias, ou todo o
  histórico. Ampliar o período depois traz as mensagens antigas.
- **Notas leves, mesmo em conversas longas:** divida cada conversa por ano,
  mês (padrão), semana ou dia, numa pasta da conversa — ou mantenha uma nota só
  por conversa. Mudar a opção reorganiza as notas existentes sem perder nada.
- **Mídias incluídas:** fotos, vídeos, áudios, documentos, contatos,
  localizações, GIFs e figurinhas aparecem como linhas identificadas, com
  legenda, duração ou nome (os arquivos continuam no WhatsApp).
- **Quem está na conversa:** a propriedade `participants` lista os membros do
  grupo (ou, numa conversa individual, a outra pessoa e você), atualizada
  sempre que a conversa recebe mensagens novas ou a nota é reconstruída.
- **Automático:** de 15 em 15 minutos até de 4 em 4 horas, e/ou ao abrir o
  Obsidian.
- **Incremental:** cada sincronização acrescenta só as mensagens novas, sem
  duplicar.
- **Texto seguro:** as mensagens são gravadas como texto puro — não conseguem
  inserir links, embeds, imagens, tags ou código no vault.
- **Português e inglês:** segue o idioma do Obsidian ou o do sistema.

## Requisitos

- **macOS** com o app oficial **WhatsApp Desktop** (não o WhatsApp Web), aberto
  pelo menos uma vez.
- **Obsidian 1.13 ou mais recente**, desktop, instalado a partir de um instalador
  recente de [obsidian.md](https://obsidian.md) (o plugin usa o SQLite que vem nele).
- **Acesso Total ao Disco** para o Obsidian (veja abaixo) — o macOS protege a
  pasta de dados do WhatsApp.

### Por que só macOS

O plugin lê o banco de mensagens que o WhatsApp Desktop oficial guarda no
computador. Só o app do macOS guarda um banco legível: o app oficial do Windows
é o WhatsApp Web dentro de uma janela, com as mensagens criptografadas no
armazenamento do navegador, e não existe WhatsApp Desktop oficial para Linux.
Nesses sistemas o plugin instala, mas fica inativo e avisa isso nas
configurações.

## Primeiros passos

1. Instale o plugin: copie `main.js`, `manifest.json` e `styles.css` da versão
   mais recente para `<seu vault>/.obsidian/plugins/whatsapp-desktop-sync/` e
   ative **WhatsApp Desktop (macOS)** em **Configurações › Plugins da comunidade**.
2. O **assistente de configuração** abre. Ele verifica o acesso ao WhatsApp e
   pergunta quais conversas sincronizar, até quando voltar e em qual pasta do
   vault gravar.
3. Clique em **Salvar e sincronizar**. Nada é gravado no vault antes disso.

### Como dar Acesso Total ao Disco

1. Abra **Ajustes do Sistema › Privacidade e Segurança › Acesso Total ao Disco**
   (o assistente tem um botão para isso).
2. Ative o **Obsidian** (adicione com **+** se ele não aparecer).
3. Feche e abra o Obsidian de novo.

> **Saiba o que está liberando.** O Acesso Total ao Disco vale para o Obsidian
> inteiro, incluindo todos os plugins da comunidade de qualquer vault que você
> abrir. Libere só se confiar nesses plugins e, num computador de trabalho,
> confira a política da empresa.

## Uso no dia a dia

| Para… | Use |
|---|---|
| Sincronizar agora | O ícone na barra lateral, o item na barra de status ou **Sincronizar agora** |
| Escolher conversas | **Configurações › Conversas › Escolher conversas** ou **Escolher conversas para sincronizar** |
| Adicionar uma conversa à lista | **Adicionar uma conversa à lista** |
| Parar de sincronizar a conversa aberta | **Parar de sincronizar esta conversa** (a nota é mantida) |
| Atualizar uma nota após edições ou exclusões no WhatsApp | **Reconstruir a nota desta conversa** |
| Atualizar todas as notas | **Configurações › Avançado › Reconstruir todas as notas** |
| Mudar a configuração depois | **Abrir o assistente de configuração** |

Os comandos ficam na paleta (Cmd+P). Reconstruir reescreve a nota a partir do
WhatsApp, então o que você escreveu à mão nela é perdido; o plugin pergunta
antes.

## Configurações

| Seção | Configuração | O que faz |
|---|---|---|
| — | Sincronizar agora | Sincroniza e mostra quando foi a última vez. |
| Conversas | Conversas sincronizadas | Todas, só grupos, só pessoais, só as escolhidas ou todas exceto as escolhidas. |
| | Escolher conversas | Abre a lista de conversas: busca, filtro por tipo, conversas arquivadas. |
| | Ignorar conversas arquivadas | Deixa de fora as conversas arquivadas no WhatsApp. |
| Período | Copiar mensagens de | Até quando voltar. Ampliar acrescenta as mensagens antigas no início de cada nota na próxima sincronização; reduzir mantém o que as notas já têm. |
| Notas | Pasta no vault | Onde as notas são criadas. A nota de índice, "WhatsApp Index", fica nela. |
| | Dividir as notas por | Ano, mês, semana (de segunda a domingo) ou dia, numa pasta por conversa; ou nada, uma nota por conversa. Mudar reorganiza as notas existentes. |
| Sincronização automática | Frequência | Sincroniza em segundo plano com o Obsidian aberto. |
| | Ao abrir o Obsidian | Sincroniza assim que o Obsidian termina de carregar. |
| Acesso ao WhatsApp | Banco de dados do WhatsApp | Mostra onde o banco foi encontrado; **Testar acesso** confere se dá para ler. |
| | Assistente de configuração | Abre o assistente de novo. |
| Avançado | Idioma | Automático, English ou Português. |
| | Caminho do banco de dados | Só é necessário se o banco do WhatsApp não for encontrado sozinho. |
| | Subpastas | Nomes das pastas de grupos e conversas pessoais (notas novas). |
| | Seu nome nas conversas | Rótulo das mensagens que você enviou. |
| | Log de depuração | Detalhes de cada sincronização no console do desenvolvedor. |
| | Reconstruir todas as notas | Reescreve todas as notas para o período atual. |

## Como funciona

- O WhatsApp Desktop guarda as mensagens em `ChatStorage.sqlite` e os nomes dos
  contatos em `ContactsV2.sqlite`, em
  `~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/`.
- O plugin abre os dois em **somente leitura** com o SQLite que já vem no
  Obsidian, então as mensagens mais novas aparecem na hora. Nada é copiado, e
  nenhum outro arquivo fora do vault é lido ou gravado.
- Cada conversa lembra a última mensagem gravada, então a próxima sincronização
  acrescenta só as mais novas — nem mensagens do mesmo segundo se repetem.
- Com a divisão por período, cada conversa tem uma pasta e cada período uma
  nota, com nomes que dizem quais dias ela cobre e ficam em ordem cronológica:
  `2026.md`, `2026-03.md`, `2026-03-09--2026-03-15.md` (semana, de segunda a
  domingo) ou `2026-03-10.md`. O título traz o período por extenso ("9 a 15 de
  março de 2026"), e as propriedades `whatsapp_period_start` e
  `whatsapp_period_end` trazem o primeiro e o último dia como datas — fáceis de
  filtrar em Bases ou Dataview. O índice aponta para a nota mais recente. Um dia
  nunca fica dividido entre duas notas.
- Mudar a divisão reorganiza as notas sem ler o WhatsApp: as seções de cada dia
  são movidas como estão, inclusive o que você escreveu nelas e mensagens mais
  antigas que o período atual. As notas novas são gravadas antes de as antigas
  irem para a lixeira. Só propriedades que você acrescentou ao frontmatter não
  são levadas. Instalações anteriores a esta opção continuam com uma nota por
  conversa até você mudar.
- Cada conversa tem o nome dela; duas conversas com o mesmo nome viram
  "Nome (2)". A conversa é identificada pelo ID do WhatsApp (`whatsapp_jid`), não
  pelo nome do arquivo: renomear uma conversa mantém a nota e o lugar dela na
  sua seleção, e **Reconstruir** move a nota (ou a pasta) para o nome atual,
  atualizando os links.
- O nome do remetente vem dos seus contatos salvos, depois do nome de perfil do
  WhatsApp e, por último, do telefone; membros desconhecidos de grupos aparecem
  como `Member-…`. Conversas sem nome aparecem pelo telefone.
- Mensagens de mídia aparecem com uma identificação e a legenda, duração, nome
  do arquivo, nome do contato ou um link de mapa. Chamadas, enquetes, reações e
  outros eventos não são gravados.

## Privacidade

- **Sem internet.** O plugin não faz requisições nem precisa de conta ou chave.
- **Somente leitura.** Os arquivos do WhatsApp nunca são alterados, e nenhuma
  cópia é gravada em disco.
- **Arquivos fora do vault:** só os dois bancos do WhatsApp citados acima são
  lidos.
- **Dados sensíveis no vault:** as notas têm mensagens de outras pessoas e, para
  contatos não salvos, números de telefone. O `data.json` do plugin
  (`.obsidian/plugins/whatsapp-desktop-sync/`) lista os IDs, nomes e
  participantes das conversas sincronizadas. Pense bem antes de sincronizar
  esses arquivos com outros serviços e siga as regras de proteção de dados
  (como a LGPD) em conversas de trabalho.

## Solução de problemas

| Problema | Solução |
|---|---|
| "Não foi possível abrir o banco de dados do WhatsApp" | Abra o WhatsApp Desktop uma vez, dê Acesso Total ao Disco ao Obsidian e reinicie-o. Se o WhatsApp guarda os dados em outro lugar, preencha **Avançado › Caminho do banco de dados**. |
| "Esta instalação do Obsidian não tem o SQLite embutido" | Baixe e instale o Obsidian mais recente em obsidian.md; as atualizações pelo app não trocam o instalador. |
| "Sistema não suportado" | Você está no Windows ou no Linux — veja [Por que só macOS](#por-que-só-macos). |
| Faltam mídias ou legendas antigas numa nota | Notas criadas antes do suporte a mídias só recebem as novas; use **Reconstruir a nota desta conversa**. |
| A primeira sincronização é lenta | Escolha um período menor; as seguintes leem só as mensagens novas. |
| Uma nota está estranha ou com duplicatas | Use **Reconstruir a nota desta conversa**. |

## Desenvolvimento

Requer Node 24 (`.nvmrc`; no mínimo 22.13, por causa do `node:sqlite`). Use um vault de teste separado.

```bash
npm install
npm run dev                      # recompila o main.js a cada mudança
npm run check                    # tipos, lint, testes com cobertura, política de licenças
npm run build                    # pacote de produção
npm run install:vault -- --link  # liga o build ao ~/Documents/Obsidian Vault
```

`VAULT="/caminho/do/vault" npm run install:vault` instala em outro vault. Os
testes usam um banco do WhatsApp sintético (`tests/fixtures/whatsapp-fixture.ts`)
e um vault em memória; os arquivos em `tests/characterization/__golden__/`
fixam o Markdown gerado.

## Licenças

MIT © 2026 Guilherme Schroder — veja [LICENSE](LICENSE). O `main.js` não inclui
código de terceiros.

Projeto independente, sem vínculo, endosso ou patrocínio do WhatsApp ou da Meta.
"WhatsApp" é marca registrada da WhatsApp LLC.
