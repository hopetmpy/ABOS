# ProjectOps — PUBLIC_TRACKED_MATRIX — ABOS

Mode: PUBLIC_TRACKED_DOCUMENTARY_MATRIX
Repository-Visibility-Observed-At-Cutover: PUBLIC
Host: `hopetmpy/ABOS`
Authority: HOST_PUBLICATION_BOUNDARY

ABOS utiliza una matriz ProjectOps documental trackeada deliberadamente para que el método, baseline, plan y continuidad pública viajen con el repositorio.

Esta es una adaptación de host. **No equivale a una instalación privada del CLI ProjectOps** y no debe afirmarse que `projectops install` fue ejecutado por el mero hecho de que estos archivos existan.

## Regla absoluta de publicación

Todo contenido bajo `ProjectOps/` y el router raíz `AGENTS.md` debe ser apto para exposición pública.

Nunca almacenar aquí:
- private keys, seed phrases o material de firma;
- OAuth access/refresh tokens;
- API keys, passwords o credenciales cloud;
- secretos de Conway, AWS, proveedores o agentes hijos;
- datos privados de clientes/usuarios;
- dumps sensibles de `~/.abos`;
- razonamiento privado o scratchpads;
- información que otorgue capacidad no autorizada sobre infraestructura o fondos.

Las referencias a wallets, balances, revenue, proveedores o entornos deben limitarse a contratos, estados, evidencia no secreta y semántica necesaria para continuidad.

## Separación de responsabilidades

- `ProjectOps/` gobierna trabajo de desarrollo/auditoría del repositorio.
- `~/.abos` gobierna estado runtime local del agente.
- GitHub/CI/PRs gobiernan evidencia de integración del source.
- proveedores externos y blockchains gobiernan su evidencia LIVE.

Ninguna de estas superficies sustituye automáticamente a otra.

## Reversibilidad

Esta matriz es documentación versionada. Puede migrarse o retirarse mediante Git preservando historia. La eliminación de ProjectOps no autoriza eliminar estado runtime ni documentación técnica del producto.
