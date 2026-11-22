import type { CareerCapabilityDefinition } from "../types"

/**
 * Capability vocabulary for the career-path catalogue.
 *
 * Keys are stable; aliases are the free-text names a person is likely to type
 * into the Career Profile. Matching is exact after normalisation, so aliases
 * are deliberately explicit rather than fuzzy. `learningStep` is a concrete
 * next action a person can take without buying a credential.
 */
export const CAREER_PATH_CAPABILITY_DEFINITIONS: readonly CareerCapabilityDefinition[] = [
  {
    key: "communication",
    label: "Communication",
    aliases: [
      "communication",
      "written communication",
      "verbal communication",
      "presentation",
      "presentations",
      "public speaking",
      "stakeholder communication",
    ],
    learningStep:
      "Write a one-page explanation of a recent piece of work for a non-specialist reader, then ask one person to summarise it back to you.",
  },
  {
    key: "stakeholder-management",
    label: "Stakeholder management",
    aliases: [
      "stakeholder management",
      "stakeholder engagement",
      "cross-functional collaboration",
    ],
    learningStep:
      "Map the people affected by a project you are running, note what each needs to know, and agree one update cadence with them.",
  },
  {
    key: "project-management",
    label: "Project management",
    aliases: [
      "project management",
      "project planning",
      "delivery management",
      "jira",
      "asana",
      "trello",
      "program management",
    ],
    learningStep:
      "Plan a small piece of work with a start date, three milestones and a named owner for each, then review what slipped.",
  },
  {
    key: "data-analysis",
    label: "Data analysis",
    aliases: [
      "data analysis",
      "data analytics",
      "analytics",
      "reporting",
      "business analysis",
      "data science",
    ],
    learningStep:
      "Take a dataset you already understand, answer one concrete question with it, and write down the decision the answer would change.",
  },
  {
    key: "sql",
    label: "SQL",
    aliases: [
      "sql",
      "postgresql",
      "postgres",
      "mysql",
      "database queries",
      "bigquery",
    ],
    learningStep:
      "Load a small public dataset into a local database and answer three questions with joins and one aggregate query.",
  },
  {
    key: "excel-spreadsheets",
    label: "Spreadsheets",
    aliases: [
      "excel",
      "microsoft excel",
      "google sheets",
      "spreadsheets",
      "spreadsheet modeling",
    ],
    learningStep:
      "Build a small tracker with one formula-driven summary and one pivot view, then have someone else update it without help.",
  },
  {
    key: "statistics",
    label: "Statistics",
    aliases: [
      "statistics",
      "statistical analysis",
      "hypothesis testing",
      "regression analysis",
    ],
    learningStep:
      "Run one comparison on real data, state the uncertainty in plain language, and explain what would make the result misleading.",
  },
  {
    key: "programming",
    label: "Programming",
    aliases: [
      "programming",
      "software development",
      "software engineering",
      "javascript",
      "java",
      "go",
      "golang",
      "c#",
      "rust",
      "ruby",
    ],
    learningStep:
      "Build and publish a small working program, including a README that explains how to run it and one trade-off you chose.",
  },
  {
    key: "typescript",
    label: "TypeScript",
    aliases: ["typescript", "ts"],
    learningStep:
      "Convert a small JavaScript project to TypeScript without using `any`, and write down the bugs the compiler caught.",
  },
  {
    key: "react",
    label: "React",
    aliases: ["react", "react.js", "reactjs", "react 19"],
    learningStep:
      "Build a small interactive interface in React and document how state flows from the form to the rendered result.",
  },
  {
    key: "nodejs",
    label: "Node.js",
    aliases: ["node.js", "nodejs", "express.js"],
    learningStep:
      "Build a small HTTP service with one validated endpoint and a test that exercises it end to end.",
  },
  {
    key: "api-design",
    label: "API design",
    aliases: [
      "api design",
      "rest api",
      "restful apis",
      "graphql",
      "grpc",
      "openapi",
    ],
    learningStep:
      "Design endpoints for a small domain, write down the request and response shapes, and note how errors are represented.",
  },
  {
    key: "testing",
    label: "Testing",
    aliases: [
      "testing",
      "unit testing",
      "integration testing",
      "jest",
      "vitest",
      "pytest",
    ],
    learningStep:
      "Add tests around the most failure-prone part of a project you own and deliberately break it to confirm they catch it.",
  },
  {
    key: "cloud",
    label: "Cloud platforms",
    aliases: [
      "cloud",
      "aws",
      "amazon web services",
      "gcp",
      "google cloud",
      "azure",
      "cloud architecture",
    ],
    learningStep:
      "Deploy a small project to a cloud provider, record the cost and access settings, and tear it down afterwards.",
  },
  {
    key: "devops",
    label: "DevOps",
    aliases: [
      "devops",
      "infrastructure as code",
      "terraform",
      "docker",
      "kubernetes",
      "deployment pipelines",
    ],
    learningStep:
      "Containerise a small app and write the deployment steps as a repeatable script rather than a list of manual commands.",
  },
  {
    key: "linux",
    label: "Linux",
    aliases: ["linux", "unix", "bash", "shell scripting"],
    learningStep:
      "Run a small service on a Linux machine, then diagnose one failure from its logs and process state.",
  },
  {
    key: "networking",
    label: "Networking",
    aliases: [
      "networking",
      "network administration",
      "tcp/ip",
      "dns",
      "bgp",
      "routing and switching",
    ],
    learningStep:
      "Trace one request from browser to server with command-line tools and explain each hop in a short write-up.",
  },
  {
    key: "system-design",
    label: "System design",
    aliases: [
      "system design",
      "distributed systems",
      "architecture",
      "scalability",
      "microservices",
    ],
    learningStep:
      "Write a one-page design for a small system with its data model, failure modes and one rejected alternative.",
  },
  {
    key: "python",
    label: "Python",
    aliases: ["python", "pandas", "numpy", "django", "flask"],
    learningStep:
      "Build a small Python tool that reads real data, reports a result, and includes tests for the tricky transformation.",
  },
  {
    key: "machine-learning",
    label: "Machine learning",
    aliases: [
      "machine learning",
      "ml",
      "deep learning",
      "pytorch",
      "tensorflow",
      "scikit-learn",
    ],
    learningStep:
      "Train and evaluate a small model against a simple baseline, then explain why the baseline is or is not beaten.",
  },
  {
    key: "data-visualization",
    label: "Data visualisation",
    aliases: [
      "data visualization",
      "data visualisation",
      "dashboards",
      "tableau",
      "looker",
      "power bi",
      "charts",
    ],
    learningStep:
      "Turn one dataset into a chart that answers a specific question, and remove every element that does not help answer it.",
  },
  {
    key: "figma",
    label: "Figma",
    aliases: ["figma", "figma prototyping", "sketch", "prototyping"],
    learningStep:
      "Recreate one existing screen in Figma with reusable components, then annotate the interaction states a developer would need.",
  },
  {
    key: "user-research",
    label: "User research",
    aliases: [
      "user research",
      "ux research",
      "usability testing",
      "customer interviews",
      "user interviews",
    ],
    learningStep:
      "Interview three people who resemble your users, ask about past behaviour rather than opinions, and record one decision the findings change.",
  },
  {
    key: "interaction-design",
    label: "Interaction design",
    aliases: [
      "interaction design",
      "ui design",
      "wireframing",
      "design thinking",
      "user flows",
    ],
    learningStep:
      "Redesign one awkward flow with a clear happy path, an error path and an empty state, and test it with one person.",
  },
  {
    key: "design-systems",
    label: "Design systems",
    aliases: ["design systems", "component library", "design tokens"],
    learningStep:
      "Document five reusable components with their states and spacing rules, then use them to rebuild one real screen.",
  },
  {
    key: "accessibility",
    label: "Accessibility",
    aliases: ["accessibility", "a11y", "wcag", "inclusive design"],
    learningStep:
      "Audit one page with a keyboard only, fix the first blocker you find, and record the before and after.",
  },
  {
    key: "copywriting",
    label: "Copywriting",
    aliases: [
      "copywriting",
      "copy writing",
      "ad copy",
      "content writing",
      "brand voice",
    ],
    learningStep:
      "Rewrite one page of copy around a single reader goal, then compare which version gets the clearer response.",
  },
  {
    key: "content-strategy",
    label: "Content strategy",
    aliases: [
      "content strategy",
      "editorial strategy",
      "content planning",
      "content marketing",
    ],
    learningStep:
      "Audit an existing content set against one audience and one goal, then publish a short plan for what to keep, merge and retire.",
  },
  {
    key: "seo",
    label: "SEO",
    aliases: [
      "seo",
      "search engine optimization",
      "keyword research",
      "technical seo",
    ],
    learningStep:
      "Pick one page, map the questions its audience actually searches for, and improve the title, structure and internal links for them.",
  },
  {
    key: "social-media",
    label: "Social media",
    aliases: [
      "social media",
      "social media marketing",
      "community management",
      "instagram",
      "linkedin content",
    ],
    learningStep:
      "Run a two-week publishing experiment on one channel, then report which format earned the most useful response and why.",
  },
  {
    key: "email-marketing",
    label: "Email marketing",
    aliases: [
      "email marketing",
      "lifecycle marketing",
      "newsletter marketing",
      "marketo",
      "mailchimp",
    ],
    learningStep:
      "Write and send a small newsletter to a real list, then compare subject lines and report the result honestly.",
  },
  {
    key: "analytics-tools",
    label: "Analytics tools",
    aliases: [
      "google analytics",
      "ga4",
      "mixpanel",
      "amplitude",
      "heap",
      "segment",
    ],
    learningStep:
      "Instrument one real user action, confirm it appears in the analytics tool, and use it to answer one product question.",
  },
  {
    key: "sales",
    label: "Sales",
    aliases: [
      "sales",
      "b2b sales",
      "prospecting",
      "cold outreach",
      "pipeline generation",
      "quota attainment",
    ],
    learningStep:
      "Research ten plausible buyers, write a short honest outreach note for each, and review which opened a conversation.",
  },
  {
    key: "crm",
    label: "CRM",
    aliases: [
      "crm",
      "salesforce",
      "hubspot",
      "pipedrive",
      "customer relationship management",
    ],
    learningStep:
      "Run a small pipeline in a free CRM, record every interaction, and use the data to explain why one opportunity stalled.",
  },
  {
    key: "negotiation",
    label: "Negotiation",
    aliases: [
      "negotiation",
      "contract negotiation",
      "closing deals",
      "deal structuring",
    ],
    learningStep:
      "Prepare for one real negotiation by writing both sides' interests, your walk-away point and three possible trades.",
  },
  {
    key: "customer-success",
    label: "Customer success",
    aliases: [
      "customer success",
      "customer support",
      "client success",
      "account management",
      "customer service",
    ],
    learningStep:
      "Take one customer problem end to end, document what they needed, and show the outcome they confirmed.",
  },
  {
    key: "onboarding",
    label: "Onboarding",
    aliases: [
      "onboarding",
      "customer onboarding",
      "user onboarding",
      "implementation",
    ],
    learningStep:
      "Write a short onboarding checklist for a new user, watch someone follow it, and fix the first place they got stuck.",
  },
  {
    key: "recruiting",
    label: "Recruiting",
    aliases: [
      "recruiting",
      "talent acquisition",
      "sourcing candidates",
      "interviewing",
    ],
    learningStep:
      "Write a structured interview question set for one role and use it with a practice candidate, scoring against evidence.",
  },
  {
    key: "people-ops",
    label: "People operations",
    aliases: [
      "people operations",
      "hr",
      "human resources",
      "employee relations",
      "people management",
    ],
    learningStep:
      "Take one people process you know, write down its steps and owners, and fix one step that depends on memory alone.",
  },
  {
    key: "operations",
    label: "Operations",
    aliases: [
      "operations",
      "business operations",
      "back office operations",
      "vendor management",
    ],
    learningStep:
      "Map one recurring operation from request to completion, then remove or automate one manual hand-off.",
  },
  {
    key: "process-improvement",
    label: "Process improvement",
    aliases: [
      "process improvement",
      "lean",
      "six sigma",
      "workflow optimization",
      "continuous improvement",
    ],
    learningStep:
      "Measure one process before a small change and again after it, and report the difference even if it did not improve.",
  },
  {
    key: "technical-writing",
    label: "Technical writing",
    aliases: [
      "technical writing",
      "developer documentation",
      "api documentation",
      "docs writing",
    ],
    learningStep:
      "Write a task-based guide for a tool you use, have someone follow it without asking you questions, and revise where they stalled.",
  },
  {
    key: "documentation",
    label: "Documentation",
    aliases: ["documentation", "docs", "knowledge base", "runbooks"],
    learningStep:
      "Document one runbook from memory, then run it deliberately on a test system and correct every missing step.",
  },
  {
    key: "information-architecture",
    label: "Information architecture",
    aliases: [
      "information architecture",
      "content modeling",
      "taxonomy design",
    ],
    learningStep:
      "Card-sort the pages of a small site with three people, then redraw the navigation around the groups they actually formed.",
  },
  {
    key: "qa-testing",
    label: "QA testing",
    aliases: [
      "quality assurance",
      "qa",
      "manual testing",
      "regression testing",
      "test automation",
      "playwright",
      "cypress",
      "selenium",
    ],
    learningStep:
      "Write a small regression suite for one real flow, run it against a deliberate bug, and record the failure clearly.",
  },
  {
    key: "cybersecurity",
    label: "Cybersecurity",
    aliases: [
      "cybersecurity",
      "security",
      "information security",
      "threat modeling",
      "vulnerability management",
    ],
    learningStep:
      "Threat-model a small system you know, rank three risks by impact and likelihood, and propose one concrete mitigation.",
  },
  {
    key: "incident-response",
    label: "Incident response",
    aliases: [
      "incident response",
      "incident management",
      "security operations",
      "forensics",
    ],
    learningStep:
      "Run a tabletop incident for a realistic failure, record the timeline, and rewrite the first response step that caused confusion.",
  },
  {
    key: "product-discovery",
    label: "Product discovery",
    aliases: [
      "product discovery",
      "customer discovery",
      "product research",
      "opportunity assessment",
    ],
    learningStep:
      "Talk to five target users about a problem area, then write one opportunity statement and the evidence that supports it.",
  },
  {
    key: "roadmapping",
    label: "Roadmapping",
    aliases: [
      "roadmapping",
      "product roadmap",
      "product strategy",
      "prioritization",
    ],
    learningStep:
      "Write a three-month roadmap with outcomes rather than features, and state what you would drop if capacity halved.",
  },
  {
    key: "experimentation",
    label: "Experimentation",
    aliases: [
      "experimentation",
      "a/b testing",
      "ab testing",
      "growth experiments",
      "feature flags",
    ],
    learningStep:
      "Design one small experiment with a clear success metric, run it, and report the result including what it cannot prove.",
  },
  {
    key: "agile",
    label: "Agile delivery",
    aliases: ["agile", "scrum", "kanban", "sprint planning"],
    learningStep:
      "Run two one-week cycles on a small piece of work and note which planning assumption was wrong.",
  },
  {
    key: "leadership",
    label: "Leadership",
    aliases: [
      "leadership",
      "team leadership",
      "engineering management",
      "managing teams",
    ],
    learningStep:
      "Take responsibility for one outcome involving other people, agree how decisions will be made, and write a short retrospective.",
  },
  {
    key: "mentoring",
    label: "Mentoring",
    aliases: ["mentoring", "coaching", "mentorship", "developing engineers"],
    learningStep:
      "Mentor one person through a concrete piece of work, agree what they will do alone, and review the result with them.",
  },
  {
    key: "git",
    label: "Git",
    aliases: ["git", "github", "gitlab", "version control"],
    learningStep:
      "Contribute a change to a shared repository with a clear commit history and respond to review feedback.",
  },
  {
    key: "ci-cd",
    label: "CI/CD",
    aliases: [
      "ci/cd",
      "cicd",
      "continuous integration",
      "continuous delivery",
      "github actions",
      "jenkins",
      "deployment automation",
    ],
    learningStep:
      "Add automated checks to a small project so every push runs tests and produces a deployable artifact.",
  },
  {
    key: "editing",
    label: "Editing",
    aliases: ["editing", "proofreading", "line editing", "style guides"],
    learningStep:
      "Edit one real document for structure first and sentences second, then compare it with the original with a reader.",
  },
  {
    key: "data-pipelines",
    label: "Data pipelines",
    aliases: ["etl", "data pipelines", "airflow", "dbt", "kafka"],
    learningStep:
      "Build a small scheduled pipeline that moves data from one source to a queryable table, with one check that fails loudly.",
  },
]
