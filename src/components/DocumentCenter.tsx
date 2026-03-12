import React, { useState, useEffect, useMemo } from 'react';
import { FileText, FileImage, File, Download, ExternalLink, Search, FolderOpen } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

type DocumentStatus = 'aguardando_analise' | 'em_analise_juridica' | 'documento_validado';

interface Document {
  id: string;
  contact_id: string | null;
  process_number: string | null;
  file_name: string;
  file_type: string;
  file_url: string;
  status: DocumentStatus;
  received_at: string;
  contact?: { name: string | null; phone_number: string };
}

const statusConfig: Record<DocumentStatus, { label: string; className: string }> = {
  aguardando_analise: {
    label: 'Aguardando Análise',
    className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  },
  em_analise_juridica: {
    label: 'Em Análise Jurídica',
    className: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  },
  documento_validado: {
    label: 'Documento Validado',
    className: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  },
};

const fileTypeIcon = (type: string) => {
  if (type === 'pdf') return <FileText className="h-5 w-5 text-red-400" />;
  if (type === 'image') return <FileImage className="h-5 w-5 text-purple-400" />;
  return <File className="h-5 w-5 text-blue-400" />;
};

const DocumentCenter: React.FC = () => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchDocuments = async () => {
    try {
      const { data, error } = await supabase
        .from('documents')
        .select('*, contact:contacts(name, phone_number)')
        .order('received_at', { ascending: false });

      if (error) throw error;

      setDocuments(
        (data || []).map((d: any) => ({
          ...d,
          contact: d.contact ?? undefined,
        }))
      );
    } catch {
      toast.error('Erro ao carregar documentos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  const handleStatusChange = async (docId: string, newStatus: DocumentStatus) => {
    try {
      const { error } = await supabase
        .from('documents')
        .update({ status: newStatus })
        .eq('id', docId);

      if (error) throw error;

      setDocuments((prev) =>
        prev.map((d) => (d.id === docId ? { ...d, status: newStatus } : d))
      );
      toast.success('Status atualizado');
    } catch {
      toast.error('Erro ao atualizar status');
    }
  };

  const filtered = useMemo(() => {
    if (!searchTerm) return documents;
    const term = searchTerm.toLowerCase();
    return documents.filter(
      (d) =>
        d.contact?.name?.toLowerCase().includes(term) ||
        d.process_number?.toLowerCase().includes(term)
    );
  }, [documents, searchTerm]);

  return (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">Central de Documentos</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Documentos recebidos via WhatsApp vinculados a clientes e processos
          </p>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por cliente ou nº do processo..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Table */}
        <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground space-y-3">
              <FolderOpen className="h-12 w-12 opacity-40" />
              <p className="text-sm font-medium">
                {searchTerm
                  ? 'Nenhum documento encontrado para esta busca'
                  : 'Nenhum documento recebido ainda'}
              </p>
              {!searchTerm && (
                <p className="text-xs max-w-sm text-center opacity-70">
                  Os documentos enviados por clientes via WhatsApp aparecerão aqui automaticamente.
                </p>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 text-muted-foreground">
                    <th className="text-left py-3 px-4 font-medium">Arquivo</th>
                    <th className="text-left py-3 px-4 font-medium">Cliente</th>
                    <th className="text-left py-3 px-4 font-medium">Nº Processo</th>
                    <th className="text-left py-3 px-4 font-medium">Tipo</th>
                    <th className="text-left py-3 px-4 font-medium">Status</th>
                    <th className="text-left py-3 px-4 font-medium">Recebido em</th>
                    <th className="text-right py-3 px-4 font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((doc) => (
                    <tr
                      key={doc.id}
                      className="border-b border-border/30 hover:bg-secondary/30 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          {fileTypeIcon(doc.file_type)}
                          <span className="truncate max-w-[200px] text-foreground">
                            {doc.file_name}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-foreground">
                        {doc.contact?.name || '—'}
                      </td>
                      <td className="py-3 px-4 text-foreground font-mono text-xs">
                        {doc.process_number || '—'}
                      </td>
                      <td className="py-3 px-4 uppercase text-xs text-muted-foreground">
                        {doc.file_type}
                      </td>
                      <td className="py-3 px-4">
                        <Select
                          value={doc.status}
                          onValueChange={(v) => handleStatusChange(doc.id, v as DocumentStatus)}
                        >
                          <SelectTrigger className="h-7 w-auto min-w-[170px] border-0 bg-transparent p-0 focus:ring-0">
                            <span
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusConfig[doc.status].className}`}
                            >
                              {statusConfig[doc.status].label}
                            </span>
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(statusConfig) as DocumentStatus[]).map((s) => (
                              <SelectItem key={s} value={s}>
                                <span className={`inline-flex items-center gap-1.5 text-xs ${statusConfig[s].className.split(' ')[1]}`}>
                                  {statusConfig[s].label}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="py-3 px-4 text-muted-foreground text-xs">
                        {new Date(doc.received_at).toLocaleDateString('pt-BR')}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => window.open(doc.file_url, '_blank')}
                            className="p-1.5 rounded-lg hover:bg-secondary/50 transition-colors text-muted-foreground hover:text-foreground"
                            title="Abrir em nova aba"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </button>
                          <a
                            href={doc.file_url}
                            download={doc.file_name}
                            className="p-1.5 rounded-lg hover:bg-secondary/50 transition-colors text-muted-foreground hover:text-foreground"
                            title="Download"
                          >
                            <Download className="h-4 w-4" />
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DocumentCenter;
