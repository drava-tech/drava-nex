--
-- PostgreSQL database dump
--

\restrict Kb6YUoqbf61qdrs92NTi4sysSuyeq7uvP3ETQso1sgh76YjCHsx5bsRCw7pfysh

-- Dumped from database version 16.14
-- Dumped by pg_dump version 16.14

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: user_role; Type: TYPE; Schema: public; Owner: cms_app
--

CREATE TYPE public.user_role AS ENUM (
    'ADMIN',
    'GUEST'
);


ALTER TYPE public.user_role OWNER TO cms_app;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: __drizzle_migrations; Type: TABLE; Schema: public; Owner: cms_app
--

CREATE TABLE public.__drizzle_migrations (
    id integer NOT NULL,
    hash text NOT NULL,
    created_at bigint
);


ALTER TABLE public.__drizzle_migrations OWNER TO cms_app;

--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: cms_app
--

CREATE SEQUENCE public.__drizzle_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.__drizzle_migrations_id_seq OWNER TO cms_app;

--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: cms_app
--

ALTER SEQUENCE public.__drizzle_migrations_id_seq OWNED BY public.__drizzle_migrations.id;


--
-- Name: account; Type: TABLE; Schema: public; Owner: cms_app
--

CREATE TABLE public.account (
    id text NOT NULL,
    user_id text NOT NULL,
    account_id text NOT NULL,
    provider_id text NOT NULL,
    access_token text,
    refresh_token text,
    id_token text,
    access_token_expires_at timestamp with time zone,
    refresh_token_expires_at timestamp with time zone,
    scope text,
    password text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.account OWNER TO cms_app;

--
-- Name: session; Type: TABLE; Schema: public; Owner: cms_app
--

CREATE TABLE public.session (
    id text NOT NULL,
    user_id text NOT NULL,
    token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    ip_address text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.session OWNER TO cms_app;

--
-- Name: user; Type: TABLE; Schema: public; Owner: cms_app
--

CREATE TABLE public."user" (
    id text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    email_verified boolean DEFAULT false NOT NULL,
    image text,
    role public.user_role DEFAULT 'GUEST'::public.user_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public."user" OWNER TO cms_app;

--
-- Name: verification; Type: TABLE; Schema: public; Owner: cms_app
--

CREATE TABLE public.verification (
    id text NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.verification OWNER TO cms_app;

--
-- Name: __drizzle_migrations id; Type: DEFAULT; Schema: public; Owner: cms_app
--

ALTER TABLE ONLY public.__drizzle_migrations ALTER COLUMN id SET DEFAULT nextval('public.__drizzle_migrations_id_seq'::regclass);


--
-- Data for Name: __drizzle_migrations; Type: TABLE DATA; Schema: public; Owner: cms_app
--

COPY public.__drizzle_migrations (id, hash, created_at) FROM stdin;
1	597338338b547d49990ce84039765bc4bcc608981ed47452cb1fe3038c003f1a	1781513685035
\.


--
-- Data for Name: account; Type: TABLE DATA; Schema: public; Owner: cms_app
--

COPY public.account (id, user_id, account_id, provider_id, access_token, refresh_token, id_token, access_token_expires_at, refresh_token_expires_at, scope, password, created_at, updated_at) FROM stdin;
NitVJlZvtcMl9TRr89B2pUEE9nyDMIMp	cvgzFSzQtSjiwEEiEj6dUPlN8FiEhixP	cvgzFSzQtSjiwEEiEj6dUPlN8FiEhixP	credential	\N	\N	\N	\N	\N	\N	e9a7bbf9b4235d219e9399447d5fd790:8143bba3cacbe3b3e6e49d8d05e49f8b148917ea5109c46dc4389a87146347257bfa8b468d1e6dca6a599d7b7f4f2907dc6c8b1c575144977e2a4814fca17450	2026-06-15 09:25:11.726+00	2026-06-15 09:25:11.726+00
\.


--
-- Data for Name: session; Type: TABLE DATA; Schema: public; Owner: cms_app
--

COPY public.session (id, user_id, token, expires_at, ip_address, user_agent, created_at, updated_at) FROM stdin;
vDGHVzUS9Jyf40XsWznqkIb9UfZpwv2h	cvgzFSzQtSjiwEEiEj6dUPlN8FiEhixP	GL4dLlLNPHVCO8bIooHEkSU5SKRGx619	2026-06-22 09:25:11.733+00			2026-06-15 09:25:11.733+00	2026-06-15 09:25:11.733+00
zv0nUJqkZhrpQuLT8FbzGpgBaDPo3gbS	cvgzFSzQtSjiwEEiEj6dUPlN8FiEhixP	Enz191hNTLvzwyfGZ3mBM3884YuXlTdO	2026-06-22 09:31:39.427+00	0000:0000:0000:0000:0000:0000:0000:0000	node	2026-06-15 09:31:39.428+00	2026-06-15 09:31:39.428+00
O07vTWb9q20s9ruhjoFN2plG3ktTjciV	cvgzFSzQtSjiwEEiEj6dUPlN8FiEhixP	JYQblVvYvWG0jg6MLzYhDe10VcDLuOrt	2026-06-22 09:33:32.709+00	0000:0000:0000:0000:0000:0000:0000:0000	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36 Edg/149.0.0.0	2026-06-15 09:33:32.709+00	2026-06-15 09:33:32.709+00
\.


--
-- Data for Name: user; Type: TABLE DATA; Schema: public; Owner: cms_app
--

COPY public."user" (id, name, email, email_verified, image, role, created_at, updated_at) FROM stdin;
cvgzFSzQtSjiwEEiEj6dUPlN8FiEhixP	The White Tusker Digital	digital@thewhitetusker.com	t	\N	ADMIN	2026-06-15 09:25:11.703+00	2026-06-15 09:25:11.703+00
\.


--
-- Data for Name: verification; Type: TABLE DATA; Schema: public; Owner: cms_app
--

COPY public.verification (id, identifier, value, expires_at, created_at, updated_at) FROM stdin;
\.


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: cms_app
--

SELECT pg_catalog.setval('public.__drizzle_migrations_id_seq', 1, true);


--
-- Name: __drizzle_migrations __drizzle_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: cms_app
--

ALTER TABLE ONLY public.__drizzle_migrations
    ADD CONSTRAINT __drizzle_migrations_pkey PRIMARY KEY (id);


--
-- Name: account account_pkey; Type: CONSTRAINT; Schema: public; Owner: cms_app
--

ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_pkey PRIMARY KEY (id);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: public; Owner: cms_app
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (id);


--
-- Name: user user_pkey; Type: CONSTRAINT; Schema: public; Owner: cms_app
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);


--
-- Name: verification verification_pkey; Type: CONSTRAINT; Schema: public; Owner: cms_app
--

ALTER TABLE ONLY public.verification
    ADD CONSTRAINT verification_pkey PRIMARY KEY (id);


--
-- Name: session_token_unique_idx; Type: INDEX; Schema: public; Owner: cms_app
--

CREATE UNIQUE INDEX session_token_unique_idx ON public.session USING btree (token);


--
-- Name: user_email_unique_idx; Type: INDEX; Schema: public; Owner: cms_app
--

CREATE UNIQUE INDEX user_email_unique_idx ON public."user" USING btree (email);


--
-- Name: account account_user_id_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: cms_app
--

ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: session session_user_id_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: cms_app
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict Kb6YUoqbf61qdrs92NTi4sysSuyeq7uvP3ETQso1sgh76YjCHsx5bsRCw7pfysh

