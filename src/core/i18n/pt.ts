// Portuguese (Brazil) strings. Same keys as en.ts — the `Messages` type makes
// a missing or misspelled key a compile error.

import type { Messages } from "./en";
import { dayParts, type Period } from "../periods";

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** "2026", "março de 2026", "9 a 15 de março de 2026", "terça, 10 de março de 2026". */
function periodTitle({ type, start, end }: Period): string {
	const a = dayParts(start);
	const b = dayParts(end);
	const month = (p: typeof a): string => MONTHS[p.month - 1] ?? "";
	const day = (p: typeof a): string => (p.day === 1 ? "1º" : String(p.day));
	switch (type) {
		case "year":
			return String(a.year);
		case "month":
			return `${month(a)} de ${a.year}`;
		case "day":
			return `${WEEKDAYS[a.weekday] ?? ""}, ${day(a)} de ${month(a)} de ${a.year}`;
		case "week":
			if (a.year !== b.year) return `${day(a)} de ${month(a)} de ${a.year} a ${day(b)} de ${month(b)} de ${b.year}`;
			if (a.month !== b.month) return `${day(a)} de ${month(a)} a ${day(b)} de ${month(b)} de ${a.year}`;
			return `${day(a)} a ${day(b)} de ${month(a)} de ${a.year}`;
	}
}

export const pt: Messages = {
	defaults: {
		groupNotesFolder: "Grupos",
		directNotesFolder: "Pessoais",
		selfDisplayName: "Eu",
	},

	commands: {
		ribbon: "Sincronizar WhatsApp agora",
		syncNow: "Sincronizar agora",
		stopSync: "Parar a sincronização",
		chooseChats: "Escolher conversas para sincronizar",
		addChat: "Adicionar uma conversa à lista",
		stopSyncingCurrent: "Parar de sincronizar esta conversa",
		rebuildCurrent: "Reconstruir a nota desta conversa",
		openSetup: "Abrir o assistente de configuração",
	},

	notices: {
		alreadyRunning: "Já há uma sincronização em andamento.",
		stopping: "Parando depois da conversa atual…",
		syncResult: (messages, chats, failed) =>
			(messages
				? `${plural(messages, "mensagem nova", "mensagens novas")} em ${plural(chats, "conversa", "conversas")}.`
				: "Nenhuma mensagem nova.") + (failed ? ` ${plural(failed, "conversa falhou", "conversas falharam")} — veja o console.` : ""),
		rebuilt: (n) => `Nota reconstruída com ${plural(n, "mensagem", "mensagens")}.`,
		rebuiltAll: (notes, failed) =>
			`${plural(notes, "nota reconstruída", "notas reconstruídas")}.` + (failed ? ` ${failed} com erro — veja o console.` : ""),
		reorganized: (chats, failed) =>
			`Notas de ${plural(chats, "conversa reorganizadas", "conversas reorganizadas")}.` + (failed ? ` ${failed} com erro — veja o console.` : ""),
		listComplete: "Todas as conversas já estão na lista.",
		testing: "Testando o acesso…",
	},

	errors: {
		dbNotFound:
			"Banco de dados do WhatsApp não encontrado. Abra o WhatsApp Desktop pelo menos uma vez ou informe o caminho em Configurações › Avançado.",
		noAccess:
			"Não foi possível abrir o banco de dados do WhatsApp. Confira se o WhatsApp Desktop está instalado e já foi aberto pelo menos uma vez, e se o Obsidian está ativado em Ajustes do Sistema › Privacidade e Segurança › Acesso Total ao Disco; depois reinicie o Obsidian.",
		noSqlite:
			"Esta instalação do Obsidian não tem o SQLite embutido de que o plugin precisa. Baixe e instale o Obsidian mais recente em obsidian.md (as atualizações pelo app não trocam o instalador).",
		unsupportedOs:
			"Este plugin funciona só no macOS: é o único sistema em que o WhatsApp Desktop oficial guarda um banco de mensagens legível.",
		emptyWindow: "Esta conversa não tem mensagens de texto no período configurado. A nota não foi alterada.",
		writeNoteFailed: (path) => `Não foi possível gravar a nota ${path}.`,
		writeFileFailed: (path) => `Não foi possível gravar o arquivo ${path}.`,
		newerSchema: (found, supported) =>
			`O data.json foi salvo por uma versão mais nova deste plugin (formato ${found}; esta versão lê até o ${supported}). ` +
			"Atualize o plugin. Seus dados não foram alterados.",
	},

	selection: {
		alreadySynced: (name) => `"${name}" já está sendo sincronizada.`,
		nowSyncing: (name) => `"${name}" passará a ser sincronizada.`,
		stopped: (name) => `"${name}" não será mais sincronizada. A nota foi mantida.`,
		notSynced: (name) => `"${name}" não está sendo sincronizada.`,
	},

	scope: {
		all: "Todas",
		groups: "Só grupos",
		personal: "Só conversas pessoais",
		include: "Só as escolhidas",
		exclude: "Todas, exceto as escolhidas",
		counts: (total, groups, personal) =>
			`${plural(total, "conversa", "conversas")} (${plural(groups, "grupo", "grupos")}, ${plural(personal, "pessoal", "pessoais")})`,
		describeAll: "Todas as conversas são copiadas para o vault.",
		describeGroups: "Só conversas em grupo são copiadas.",
		describePersonal: "Só conversas individuais são copiadas.",
		describeInclude: (counts) => `Só as escolhidas são copiadas: ${counts}.`,
		describeIncludeNone: "Nenhuma conversa escolhida — nada será copiado.",
		describeExclude: (counts) => `Todas são copiadas, exceto as escolhidas: ${counts}.`,
		describeExcludeNone: "Nenhuma exceção — todas as conversas são copiadas.",
	},

	period: {
		days: (n) => `Últimos ${n} dias`,
		year: "Último ano",
		all: "Todo o histórico",
	},

	interval: {
		off: "Desligada",
		minutes: (n) => `A cada ${n} min`,
		hours: (n) => `A cada ${n} h`,
	},

	validation: {
		dotSegments: 'O nome da pasta não pode ser "." nem "..".',
		blankSegment: "O nome da pasta não pode ficar em branco.",
		illegalChars: 'O nome da pasta não pode conter : * ? " < > |',
	},

	settings: {
		unsupported: "Sistema não suportado",
		syncNow: "Sincronizar agora",
		lastSync: (when) => `Última sincronização: ${when}.`,
		neverSynced: "Nenhuma sincronização feita ainda.",
		syncButton: "Sincronizar",
		stopButton: "Parar",

		chatsHeading: "Conversas",
		scope: "Conversas sincronizadas",
		choose: "Escolher conversas",
		chooseDesc: "Abre a lista de conversas do WhatsApp para marcar quais são sincronizadas.",
		chooseButton: "Escolher…",
		skipArchived: "Ignorar conversas arquivadas",
		skipArchivedDesc: "Conversas arquivadas no WhatsApp não são copiadas.",

		periodHeading: "Período",
		period: "Copiar mensagens de",
		periodDesc:
			"Mensagens mais antigas não são copiadas. Ampliar o período acrescenta as mensagens antigas que faltam no início de cada nota na próxima sincronização; reduzir mantém o que as notas já têm.",

		notesHeading: "Notas",
		folder: "Pasta no vault",
		folderDesc: (index) => `As notas das conversas ficam nesta pasta. A nota "${index}" lista todas as conversas.`,
		grouping: "Dividir as notas por",
		groupingDesc:
			"Uma nota por conversa, ou uma nota por período numa pasta por conversa — mais leve de abrir em conversas longas. Mudar reorganiza as notas existentes.",
		groupingOptions: { single: "Nada (uma nota por conversa)", year: "Ano", month: "Mês", week: "Semana", day: "Dia" },

		autoHeading: "Sincronização automática",
		interval: "Frequência",
		intervalDesc: "Sincroniza em segundo plano enquanto o Obsidian estiver aberto.",
		onStartup: "Ao abrir o Obsidian",
		onStartupDesc: "Sincroniza assim que o Obsidian termina de carregar.",

		accessHeading: "Acesso ao WhatsApp",
		db: "Banco de dados do WhatsApp",
		dbFound: (path) => `Lê ${path}. Use "Testar acesso" para conferir.`,
		dbNotFound: "Não encontrado. Abra o WhatsApp Desktop pelo menos uma vez ou informe o caminho em Avançado.",
		testButton: "Testar acesso",
		setup: "Assistente de configuração",
		setupDesc: "Guia pelos passos de acesso, conversas, período e pasta.",
		setupButton: "Abrir",

		advancedHeading: "Avançado",
		language: "Idioma",
		languageDesc:
			"Automático segue o idioma do Obsidian ou, se ele não tiver um definido, o do sistema. Os nomes dos comandos mudam depois de recarregar o Obsidian.",
		languageAuto: "Automático",
		dbPath: "Caminho do banco de dados",
		dbPathDesc: "Caminho completo do ChatStorage.sqlite. Deixe vazio para detectar automaticamente.",
		groupNotesFolder: "Subpasta dos grupos",
		directNotesFolder: "Subpasta das conversas pessoais",
		subfolderDesc: "Dentro da pasta no vault. Vale para notas novas.",
		selfDisplayName: "Seu nome nas conversas",
		ownNameDesc: "Rótulo das mensagens enviadas por você.",
		debug: "Log de depuração",
		debugDesc: "Registra os detalhes de cada sincronização no console do desenvolvedor (Cmd+Option+I).",
		rebuildAll: "Reconstruir todas as notas",
		rebuildAllDesc:
			"Reescreve todas as notas de conversa a partir do WhatsApp com as mensagens do período configurado. Use depois de mudar o período ou se alguma nota estiver desatualizada. O que você escreveu à mão é perdido.",
		rebuildAllButton: "Reconstruir",
	},

	probe: {
		ok: (n) => `Acesso OK: ${plural(n, "mensagem de texto", "mensagens de texto")}.`,
		names: (contacts, pushNames) =>
			`Nomes: ${plural(contacts, "contato salvo", "contatos salvos")} e ${plural(pushNames, "nome de perfil", "nomes de perfil")}.`,
		contactsMissing: "Agenda de contatos não encontrada: remetentes sem contato salvo aparecem pelo nome de perfil ou telefone.",
		samples: "Exemplos de remetentes:",
		you: "(você)",
		kindPhone: "telefone",
		kindNone: "sem identificação",
	},

	setup: {
		title: "Configurar o WhatsApp Desktop (macOS)",
		intro: "Copia suas conversas do WhatsApp Desktop para notas neste vault. Somente leitura: nada é enviado nem alterado no WhatsApp.",
		accessStep: "1. Acesso ao WhatsApp",
		checking: "Verificando…",
		accessOk: "Banco de dados do WhatsApp encontrado e legível.",
		retry: "Testar de novo",
		openPrivacy: "Abrir Ajustes de Privacidade",
		chatsStep: "2. Conversas",
		periodStep: "3. Período",
		folderStep: "4. Pasta no vault",
		later: "Agora não",
		finish: "Salvar e sincronizar",
	},

	picker: {
		titleInclude: "Conversas a sincronizar",
		titleExclude: "Conversas a ignorar",
		hintInclude: "Marque as conversas que devem ser copiadas para o vault.",
		hintExclude: "Marque as conversas que não devem ser copiadas.",
		loading: "Lendo as conversas do WhatsApp…",
		loadFailed: (msg) => `Não foi possível ler as conversas: ${msg}`,
		searchPlaceholder: "Buscar por nome",
		showAll: "Todas",
		showGroups: "Grupos",
		showPersonal: "Pessoais",
		showChecked: "Marcadas",
		showArchived: "Mostrar arquivadas",
		checkShown: "Marcar as exibidas",
		uncheckAll: "Desmarcar todas",
		summary: (checked, shown) => `${plural(checked, "marcada", "marcadas")} · ${plural(shown, "exibida", "exibidas")}`,
		noMatches: "Nenhuma conversa encontrada.",
		noMessages: "sem mensagens",
		kindGroup: "Grupo",
		kindPersonal: "Pessoal",
		messages: (n) => plural(n, "mensagem", "mensagens"),
		archived: "arquivada",
		missing: "não encontrada no WhatsApp",
		truncated: (max, total) => `Mostrando as ${max} mais recentes de ${total}. Use a busca para encontrar as demais.`,
		cancel: "Cancelar",
		save: (n) => (n ? `Salvar (${n})` : "Salvar"),
		saveFailed: (msg) => `Não foi possível salvar a seleção: ${msg}`,
	},


	modals: {
		cancel: "Cancelar",
		suggestPlaceholder: "Buscar conversa",
		suggestGroup: "grupo",
		suggestPersonal: "pessoal",
		rebuildTitle: "Reconstruir esta nota?",
		rebuildBody: (name) =>
			`A nota de "${name}" será reescrita com as mensagens do período configurado. O que você escreveu à mão nela será perdido.`,
		rebuildAllTitle: "Reconstruir todas as notas?",
		rebuildAllBody:
			"Todas as notas de conversa serão reescritas com as mensagens do período configurado. O que você escreveu à mão nelas será perdido.",
		rebuildConfirm: "Reconstruir",
		reorganizeTitle: "Reorganizar as notas?",
		reorganizeBody: (chats, layout) =>
			`As notas de ${plural(chats, "conversa", "conversas")} serão reagrupadas por "${layout}". Nada é lido do WhatsApp e nenhuma mensagem se perde; os arquivos antigos vão para a lixeira. Propriedades que você acrescentou ao frontmatter não são levadas.`,
		reorganizeConfirm: "Reorganizar",
	},

	statusBar: {
		idle: "WhatsApp",
		syncing: "WhatsApp · sincronizando…",
		error: "WhatsApp · erro",
		tooltip: "Sincronizar WhatsApp agora",
	},

	media: {
		image: "Imagem",
		video: "Vídeo",
		audio: "Áudio",
		contact: "Contato",
		location: "Localização",
		document: "Documento",
		gif: "GIF",
		sticker: "Figurinha",
	},

	notes: {
		unknownSender: "Desconhecido",
		indexIntro: (n) => `_${plural(n, "conversa", "conversas")} · atualizado a cada sincronização._`,
		indexPersonal: "Conversas pessoais",
		indexGroups: "Grupos",
		indexNone: "_Nenhuma ainda._",
		indexMessages: (n) => plural(n, "mensagem", "mensagens"),
		periodTitle,
	},
};
