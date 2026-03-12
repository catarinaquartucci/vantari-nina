
-- Create enum for document analysis status
CREATE TYPE public.document_status AS ENUM ('aguardando_analise', 'em_analise_juridica', 'documento_validado');

-- Create documents table
CREATE TABLE public.documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  process_number TEXT,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL, -- 'pdf', 'docx', 'image'
  file_url TEXT NOT NULL,
  status public.document_status NOT NULL DEFAULT 'aguardando_analise',
  received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  user_id UUID
);

-- Enable RLS
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all documents
CREATE POLICY "Authenticated users can read documents"
  ON public.documents FOR SELECT
  USING (auth.role() = 'authenticated'::text);

-- Authenticated users can insert documents
CREATE POLICY "Authenticated users can insert documents"
  ON public.documents FOR INSERT
  WITH CHECK (auth.role() = 'authenticated'::text);

-- Authenticated users can update documents (status changes)
CREATE POLICY "Authenticated users can update documents"
  ON public.documents FOR UPDATE
  USING (auth.role() = 'authenticated'::text);

-- Authenticated users can delete documents
CREATE POLICY "Authenticated users can delete documents"
  ON public.documents FOR DELETE
  USING (auth.role() = 'authenticated'::text);

-- Trigger for updated_at
CREATE TRIGGER update_documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Index for search
CREATE INDEX idx_documents_process_number ON public.documents(process_number);
CREATE INDEX idx_documents_contact_id ON public.documents(contact_id);
CREATE INDEX idx_documents_status ON public.documents(status);
