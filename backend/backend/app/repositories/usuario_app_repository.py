from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.usuario_app import UsuarioApp


class UsuarioAppRepository:
    def get_by_identity(
        self,
        db: Session,
        *,
        tipo_documento: str,
        identificacion: str,
    ) -> UsuarioApp | None:
        statement = select(UsuarioApp).where(
            UsuarioApp.tipo_documento == tipo_documento,
            UsuarioApp.identificacion == identificacion,
        )
        return db.execute(statement).scalar_one_or_none()

    def create(
        self,
        db: Session,
        *,
        tipo_documento: str,
        identificacion: str,
        password_hash: str,
        rol_id: int,
    ) -> UsuarioApp:
        usuario = UsuarioApp(
            tipo_documento=tipo_documento,
            identificacion=identificacion,
            password_hash=password_hash,
            rol_id=rol_id,
        )
        db.add(usuario)
        db.commit()
        db.refresh(usuario)
        return usuario
